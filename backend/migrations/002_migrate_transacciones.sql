-- ============================================================
-- NEXUS DOC AI SUITE — Migración 002
-- Migrar datos de tabla `transacciones` al nuevo schema
-- ============================================================
-- ESTRATEGIA: Los registros existentes en `transacciones`
-- son comprobantes procesados por OCR (cheques, depósitos).
-- Los migramos como `metodos_pago` con tipo='otro' y
-- origen='ocr_upload', preservando toda la trazabilidad.
-- ============================================================

DO $$
DECLARE
  rec RECORD;
  v_fecha DATE;
BEGIN

  FOR rec IN SELECT * FROM transacciones LOOP

    -- Intentar parsear la fecha del documento
    BEGIN
      v_fecha := rec.fecha_documento::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_fecha := CURRENT_DATE;
    END;

    -- Solo migrar si el monto es válido (>0) y no existe ya migrado
    IF rec.monto IS NOT NULL AND rec.monto > 0 THEN
      INSERT INTO metodos_pago (
        tipo,
        fecha_documento,
        monto_inicial,
        saldo_utilizado,
        estado,
        descripcion,
        url_comprobante,
        file_hash,
        raw_ocr,
        origen,
        usuario_creacion,
        notas,
        created_at
      )
      VALUES (
        'otro',
        v_fecha,
        rec.monto,
        0,
        'disponible',
        COALESCE(rec.beneficiario, 'Migrado desde sistema anterior'),
        rec.url_archivo,
        rec.file_hash,
        rec.raw_ocr,
        'ocr_upload',
        COALESCE(rec.usuario_email, 'sistema@nexus.com'),
        'Migrado automáticamente desde tabla transacciones (ID original: ' || rec.id || ')',
        rec.created_at
      )
      ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;

  RAISE NOTICE 'Migración completada: % registros procesados desde transacciones.',
    (SELECT COUNT(*) FROM transacciones);
END $$;

-- Verificación post-migración
SELECT
  'transacciones (origen)'  AS tabla,
  COUNT(*)                  AS total,
  SUM(monto)                AS monto_total
FROM transacciones

UNION ALL

SELECT
  'metodos_pago (destino)'  AS tabla,
  COUNT(*)                  AS total,
  SUM(monto_inicial)        AS monto_total
FROM metodos_pago
WHERE origen = 'ocr_upload';
