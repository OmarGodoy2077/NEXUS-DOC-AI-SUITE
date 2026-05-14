-- ============================================================
-- NEXUS DOC AI SUITE — Migración 001 (consolidada)
-- Schema Financiero: Conciliación y Control (Guatemala/SAT)
--
-- Incluye las migraciones posteriores ya integradas:
--   002 — Importaciones Excel SAT
--   003 — Agregado url_comprobante a v_conciliacion_detalle
--   004 — Estado 'borrador' en metodos_pago + ajuste trigger
--   005 — Auditoría de tokens de IA (tokens_prompt/respuesta/total + ocr_modelo)
--   006 — Trigger soporta monto_total negativo (notas de crédito)
--   007 — Estado 'nota_credito' en estado_factura
--   008 — Trigger excluye NCRE del recálculo (estado permanente)
-- ============================================================

-- ─────────────────────────────────────────────
-- EXTENSIONES
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
DO $$ BEGIN
  -- 'nota_credito': estado especial para NCRE (migración 007). No se concilia,
  -- el monto va en negativo y se usa como ajuste al cuadrar facturas del mismo emisor.
  CREATE TYPE estado_factura AS ENUM ('pendiente', 'parcial', 'pagada', 'anulada', 'nota_credito');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_metodo_pago AS ENUM ('cheque', 'transferencia', 'deposito', 'efectivo', 'anticipo', 'otro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 'borrador': estado temporal tras OCR, antes de que el usuario confirme (migración 004)
  CREATE TYPE estado_metodo_pago AS ENUM ('borrador', 'disponible', 'utilizado_parcial', 'utilizado_total', 'anulado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE origen_registro AS ENUM ('sat_excel', 'ocr_upload', 'manual', 'importacion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_documento_fiscal AS ENUM ('compra', 'venta', 'nota_credito', 'nota_debito', 'otro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────
-- TABLA: facturas
-- Almacena DTE-FEL del SAT y documentos OCR
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturas (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Datos DTE-FEL (SAT Guatemala)
  numero_autorizacion   TEXT UNIQUE,
  tipo_dte              VARCHAR(20),
  serie                 VARCHAR(50),
  numero_dte            VARCHAR(50),
  fecha_emision         TIMESTAMPTZ,
  fecha_anulacion       TIMESTAMPTZ,
  marca_anulado         BOOLEAN DEFAULT FALSE,
  exportacion           BOOLEAN DEFAULT FALSE,
  ubicacion_temporal    BOOLEAN DEFAULT FALSE,
  clasificacion_emisor  VARCHAR(50),

  -- Emisor
  nit_emisor            VARCHAR(20),
  nombre_emisor         TEXT,
  codigo_establecimiento VARCHAR(20),
  nombre_establecimiento TEXT,

  -- Receptor
  id_receptor           VARCHAR(20),
  nombre_receptor       TEXT,

  -- Certificador (SAT)
  nit_certificador      VARCHAR(20),
  nombre_certificador   TEXT,

  -- Montos
  moneda                VARCHAR(5) DEFAULT 'GTQ',
  monto_total           DECIMAL(15,2) NOT NULL DEFAULT 0,
  monto_iva             DECIMAL(15,2) DEFAULT 0,
  otros_impuestos       JSONB DEFAULT '{}',

  -- Control de conciliación (calculado por triggers)
  monto_pagado          DECIMAL(15,2) NOT NULL DEFAULT 0,
  saldo_pendiente       DECIMAL(15,2) GENERATED ALWAYS AS (monto_total - monto_pagado) STORED,
  estado                estado_factura NOT NULL DEFAULT 'pendiente',

  -- Clasificación contable
  tipo_documento        tipo_documento_fiscal DEFAULT 'compra',

  -- Trazabilidad de origen
  origen                origen_registro DEFAULT 'manual',
  url_archivo           TEXT,
  raw_ocr               TEXT,
  file_hash             TEXT,

  -- Auditoría
  usuario_creacion      TEXT NOT NULL DEFAULT 'sistema',
  notas                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE facturas IS 'Facturas DTE-FEL del SAT y documentos procesados por OCR';
COMMENT ON COLUMN facturas.saldo_pendiente IS 'Calculado automáticamente: monto_total - monto_pagado';
COMMENT ON COLUMN facturas.monto_pagado IS 'Actualizado por trigger cuando se registran conciliaciones';

-- ─────────────────────────────────────────────
-- TABLA: metodos_pago
-- Cheques, transferencias, depósitos, efectivo
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metodos_pago (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Tipo e identificación
  tipo              tipo_metodo_pago NOT NULL,
  banco             VARCHAR(100),
  numero_documento  VARCHAR(100),        -- No. cheque, referencia de transferencia
  fecha_documento   DATE NOT NULL,

  -- Control de saldo (el núcleo de la lógica N:M)
  monto_inicial     DECIMAL(15,2) NOT NULL CHECK (monto_inicial > 0),
  saldo_utilizado   DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (saldo_utilizado >= 0),
  saldo_disponible  DECIMAL(15,2) GENERATED ALWAYS AS (monto_inicial - saldo_utilizado) STORED,
  estado            estado_metodo_pago NOT NULL DEFAULT 'disponible',

  -- Descripción y soporte
  descripcion       TEXT,
  url_comprobante   TEXT,
  file_hash         TEXT,
  raw_ocr           TEXT,

  -- Auditoría del modelo de IA usado (migración 005)
  tokens_prompt     INTEGER,
  tokens_respuesta  INTEGER,
  tokens_total      INTEGER,
  ocr_modelo        VARCHAR(60),

  -- Origen
  origen            origen_registro DEFAULT 'manual',

  -- Auditoría
  usuario_creacion  TEXT NOT NULL DEFAULT 'sistema',
  notas             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT saldo_no_negativo CHECK (saldo_utilizado <= monto_inicial)
);

COMMENT ON TABLE metodos_pago IS 'Fuentes de fondos: cheques, transferencias, depósitos, efectivo, anticipos';
COMMENT ON COLUMN metodos_pago.saldo_disponible IS 'monto_inicial - saldo_utilizado. Disponible para vincular a facturas.';

-- ─────────────────────────────────────────────
-- TABLA: conciliaciones
-- Tabla pivot N:M entre facturas y metodos_pago
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conciliaciones (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Relación N:M
  factura_id          UUID NOT NULL REFERENCES facturas(id) ON DELETE RESTRICT,
  metodo_pago_id      UUID NOT NULL REFERENCES metodos_pago(id) ON DELETE RESTRICT,

  -- Monto aplicado en esta vinculación específica
  monto_aplicado      DECIMAL(15,2) NOT NULL CHECK (monto_aplicado > 0),
  fecha_conciliacion  DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Auditoría
  usuario_conciliacion TEXT NOT NULL DEFAULT 'sistema',
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  -- Evitar duplicados exactos en la misma operación
  CONSTRAINT uq_conciliacion UNIQUE (factura_id, metodo_pago_id, created_at)
);

COMMENT ON TABLE conciliaciones IS 'Vinculación N:M entre facturas y métodos de pago. Soporta pagos parciales y pagos de múltiples facturas con un cheque.';

-- ─────────────────────────────────────────────
-- TABLA: importaciones_excel
-- Historial de archivos Excel importados del SAT
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importaciones_excel (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre_archivo        TEXT NOT NULL,
  file_hash             TEXT UNIQUE,           -- Previene reimportar el mismo archivo
  total_filas           INT DEFAULT 0,
  filas_importadas      INT DEFAULT 0,
  filas_duplicadas      INT DEFAULT 0,
  filas_error           INT DEFAULT 0,
  mapeo_columnas        JSONB DEFAULT '{}',    -- Mapeo usado en esta importación
  periodo_desde         DATE,
  periodo_hasta         DATE,
  estado_importacion    VARCHAR(20) DEFAULT 'completada',
  errores_detalle       JSONB DEFAULT '[]',
  usuario_importacion   TEXT NOT NULL DEFAULT 'sistema',
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE importaciones_excel IS 'Registro de todas las importaciones de Excel de la Agencia Virtual SAT';

-- ─────────────────────────────────────────────
-- TABLA: transacciones (legacy — pre-refactor del sistema)
-- Se mantiene para compatibilidad; el sistema actual usa metodos_pago.
-- Las operaciones nuevas se registran en metodos_pago + conciliaciones.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transacciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, NOW()),
  beneficiario      TEXT,
  monto             DECIMAL(15,2),
  fecha_documento   TEXT,
  url_archivo       TEXT,
  raw_ocr           TEXT,
  file_hash         TEXT,
  usuario_email     TEXT
);

COMMENT ON TABLE transacciones IS 'Tabla legacy del sistema anterior. Conservada para histórico — el flujo actual usa metodos_pago + conciliaciones.';

-- ─────────────────────────────────────────────
-- ÍNDICES DE PERFORMANCE
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_facturas_estado         ON facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha_emision  ON facturas(fecha_emision);
CREATE INDEX IF NOT EXISTS idx_facturas_nit_emisor     ON facturas(nit_emisor);
CREATE INDEX IF NOT EXISTS idx_facturas_nit_receptor   ON facturas(id_receptor);
CREATE INDEX IF NOT EXISTS idx_facturas_numero_auth    ON facturas(numero_autorizacion);
CREATE INDEX IF NOT EXISTS idx_facturas_file_hash      ON facturas(file_hash);
CREATE INDEX IF NOT EXISTS idx_facturas_origen         ON facturas(origen);

CREATE INDEX IF NOT EXISTS idx_metodos_pago_estado     ON metodos_pago(estado);
CREATE INDEX IF NOT EXISTS idx_metodos_pago_tipo       ON metodos_pago(tipo);
CREATE INDEX IF NOT EXISTS idx_metodos_pago_fecha      ON metodos_pago(fecha_documento);

CREATE INDEX IF NOT EXISTS idx_conciliaciones_factura  ON conciliaciones(factura_id);
CREATE INDEX IF NOT EXISTS idx_conciliaciones_pago     ON conciliaciones(metodo_pago_id);
CREATE INDEX IF NOT EXISTS idx_conciliaciones_fecha    ON conciliaciones(fecha_conciliacion);

-- ─────────────────────────────────────────────
-- FUNCIÓN: Actualizar estado de factura
-- Se dispara tras INSERT/UPDATE/DELETE en conciliaciones
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_actualizar_estado_factura()
RETURNS TRIGGER AS $$
DECLARE
  v_factura_id    UUID;
  v_monto_total   DECIMAL(15,2);
  v_monto_pagado  DECIMAL(15,2);
  v_tipo_doc      tipo_documento_fiscal;
  v_nuevo_estado  estado_factura;
BEGIN
  -- Determinar qué factura procesar
  IF TG_OP = 'DELETE' THEN
    v_factura_id := OLD.factura_id;
  ELSE
    v_factura_id := NEW.factura_id;
  END IF;

  -- Sumar todo lo conciliado para esta factura
  SELECT f.monto_total, f.tipo_documento, COALESCE(SUM(c.monto_aplicado), 0)
  INTO   v_monto_total, v_tipo_doc, v_monto_pagado
  FROM   facturas f
  LEFT JOIN conciliaciones c ON c.factura_id = f.id
  WHERE  f.id = v_factura_id
  GROUP  BY f.monto_total, f.tipo_documento;

  -- Notas de crédito: estado fijo 'nota_credito', no participan en conciliaciones (migración 007/008)
  IF v_tipo_doc = 'nota_credito' THEN
    v_nuevo_estado := 'nota_credito';
  ELSIF v_monto_pagado = 0 THEN
    v_nuevo_estado := 'pendiente';
  ELSIF v_monto_pagado < v_monto_total THEN
    v_nuevo_estado := 'parcial';
  ELSE
    v_nuevo_estado := 'pagada';
  END IF;

  -- Actualizar factura — preservar estados que no deben recalcularse
  UPDATE facturas
  SET    monto_pagado = v_monto_pagado,
         estado       = v_nuevo_estado,
         updated_at   = NOW()
  WHERE  id = v_factura_id
    AND  estado NOT IN ('anulada', 'nota_credito');

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- FUNCIÓN: Actualizar saldo de método de pago
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_actualizar_saldo_metodo_pago()
RETURNS TRIGGER AS $$
DECLARE
  v_pago_id       UUID;
  v_monto_inicial DECIMAL(15,2);
  v_saldo_usado   DECIMAL(15,2);
  v_nuevo_estado  estado_metodo_pago;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_pago_id := OLD.metodo_pago_id;
  ELSE
    v_pago_id := NEW.metodo_pago_id;
  END IF;

  SELECT
    mp.monto_inicial,
    COALESCE(SUM(c.monto_aplicado), 0)
  INTO v_monto_inicial, v_saldo_usado
  FROM metodos_pago mp
  LEFT JOIN conciliaciones c ON c.metodo_pago_id = mp.id
  WHERE mp.id = v_pago_id
  GROUP BY mp.monto_inicial;

  -- Calcular estado del método de pago
  IF v_saldo_usado = 0 THEN
    v_nuevo_estado := 'disponible';
  ELSIF v_saldo_usado < v_monto_inicial THEN
    v_nuevo_estado := 'utilizado_parcial';
  ELSE
    v_nuevo_estado := 'utilizado_total';
  END IF;

  -- Validar que no se exceda el monto inicial
  IF v_saldo_usado > v_monto_inicial THEN
    RAISE EXCEPTION 'El monto aplicado (%.2f) excede el monto inicial del método de pago (%.2f)',
      v_saldo_usado, v_monto_inicial;
  END IF;

  -- No sobrescribir registros en 'borrador' (aún no confirmados) ni 'anulado'
  UPDATE metodos_pago
  SET
    saldo_utilizado = v_saldo_usado,
    estado          = v_nuevo_estado,
    updated_at      = NOW()
  WHERE id = v_pago_id
    AND estado NOT IN ('anulado', 'borrador');

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_actualizar_factura ON conciliaciones;
CREATE TRIGGER trg_actualizar_factura
  AFTER INSERT OR UPDATE OR DELETE ON conciliaciones
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_estado_factura();

DROP TRIGGER IF EXISTS trg_actualizar_metodo_pago ON conciliaciones;
CREATE TRIGGER trg_actualizar_metodo_pago
  AFTER INSERT OR UPDATE OR DELETE ON conciliaciones
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_saldo_metodo_pago();

-- Trigger updated_at automático en facturas y metodos_pago
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facturas_updated_at ON facturas;
CREATE TRIGGER trg_facturas_updated_at
  BEFORE UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_metodos_pago_updated_at ON metodos_pago;
CREATE TRIGGER trg_metodos_pago_updated_at
  BEFORE UPDATE ON metodos_pago
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ─────────────────────────────────────────────
-- VIEW: conciliacion_detalle
-- Vista drill-down para la interfaz
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_conciliacion_detalle AS
SELECT
  f.id                    AS factura_id,
  f.numero_autorizacion,
  f.serie,
  f.numero_dte,
  f.fecha_emision,
  f.nombre_emisor,
  f.nombre_receptor,
  f.monto_total,
  f.monto_pagado,
  f.saldo_pendiente,
  f.estado                AS estado_factura,
  f.tipo_documento,
  f.origen                AS origen_factura,

  -- Detalle del pago vinculado
  c.id                    AS conciliacion_id,
  c.monto_aplicado,
  c.fecha_conciliacion,
  c.usuario_conciliacion,
  c.notas                 AS notas_conciliacion,

  -- Método de pago
  mp.id                   AS metodo_pago_id,
  mp.tipo                 AS tipo_pago,
  mp.banco,
  mp.numero_documento     AS numero_cheque_o_referencia,
  mp.fecha_documento      AS fecha_pago,
  mp.monto_inicial        AS monto_pago_original,
  mp.saldo_disponible     AS saldo_restante_pago,
  mp.estado               AS estado_pago,
  mp.url_comprobante

FROM facturas f
LEFT JOIN conciliaciones c  ON c.factura_id     = f.id
LEFT JOIN metodos_pago mp   ON mp.id            = c.metodo_pago_id;

-- ─────────────────────────────────────────────
-- VIEW: reporte_conciliacion
-- Para reportes por período
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_reporte_conciliacion AS
SELECT
  DATE_TRUNC('month', f.fecha_emision)    AS periodo,
  f.tipo_documento,
  f.estado,
  COUNT(*)                                AS total_facturas,
  SUM(f.monto_total)                      AS monto_total_facturas,
  SUM(f.monto_pagado)                     AS monto_total_pagado,
  SUM(f.saldo_pendiente)                  AS saldo_total_pendiente,
  COUNT(*) FILTER (WHERE f.estado = 'pendiente')  AS facturas_pendientes,
  COUNT(*) FILTER (WHERE f.estado = 'parcial')    AS facturas_parciales,
  COUNT(*) FILTER (WHERE f.estado = 'pagada')     AS facturas_pagadas,
  COUNT(*) FILTER (WHERE f.estado = 'anulada')    AS facturas_anuladas
FROM facturas f
GROUP BY DATE_TRUNC('month', f.fecha_emision), f.tipo_documento, f.estado;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY (preparado para multi-tenant)
-- ─────────────────────────────────────────────
ALTER TABLE facturas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE metodos_pago      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliaciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE importaciones_excel ENABLE ROW LEVEL SECURITY;

-- Política permisiva temporal (ajustar con auth real)
CREATE POLICY "allow_all_authenticated" ON facturas
  FOR ALL USING (true);
CREATE POLICY "allow_all_authenticated" ON metodos_pago
  FOR ALL USING (true);
CREATE POLICY "allow_all_authenticated" ON conciliaciones
  FOR ALL USING (true);
CREATE POLICY "allow_all_authenticated" ON importaciones_excel
  FOR ALL USING (true);
