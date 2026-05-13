# Backend Technical Documentation - NEXUS DOC AI SUITE v2.0

This document provides a technical overview of the v2.0 backend system, its architecture, data model, and logic for scaling. It is based on the comprehensive technical documentation.

## 1. Architecture Overview

The backend is a Node.js application using the Express framework. Its primary responsibilities have expanded in v2.0 to include:
- Handling document processing (OCR for checks, etc.).
- A robust two-step process for importing and parsing SAT DTE-FEL Excel files.
- Managing the entire lifecycle of financial reconciliation between invoices (`facturas`) and `metodos_pago`.
- Interacting with the Supabase database, which now contains significant business logic (triggers, generated columns).

### Core Components:

- **`index.js`**: Main entry point, sets up Express, middleware, and API routes.
- **Express Server**: Handles all API requests.
- **Middleware**:
  - `cors`: Enables Cross-Origin Resource Sharing.
  - `express.json`: Parses incoming JSON requests.
  - `multer`: Handles `multipart/form-data` for both OCR document uploads and Excel file imports.
- **`utils/excelParser.js`**: A new, crucial utility for parsing the complex structure of SAT Excel files.
- **Supabase Client**: Uses the `service_role` key for elevated privileges required to interact with the database schema, including calling functions and handling complex inserts.

## 2. Data Model and Database Logic

The v2.0 data model is the core of the application, designed for financial integrity and automation.

- **Tables**:
  - `facturas`: Stores all invoices, primarily from SAT Excel imports.
  - `metodos_pago`: Stores all payment methods (checks, transfers, etc.), including those created from OCR.
  - `conciliaciones`: A pivot table that links invoices and payments, creating a many-to-many relationship.
  - `importaciones_excel`: A log table to track Excel imports and prevent duplicates.

- **Database Automation (Triggers & Generated Columns)**:
  - **`trg_actualizar_factura`**: Fires after any change in `conciliaciones`. It automatically recalculates the `monto_pagado` on the associated invoice and updates its `estado` (`pendiente`, `parcial`, `pagada`).
  - **`trg_actualizar_metodo_pago`**: Also fires after changes in `conciliaciones`. It recalculates the `saldo_utilizado` on the payment method and updates its state. It includes a check to prevent over-applying funds.
  - **Generated Columns**: `saldo_pendiente` on invoices and `saldo_disponible` on payment methods are calculated automatically by PostgreSQL. The application **never** writes to these fields, ensuring data consistency.

## 3. Key API Flows

### SAT Excel Import Flow

This is a two-step process to ensure accuracy:

1.  **`POST /api/importacion-excel/analizar`**:
    - The user uploads an Excel file.
    - The backend uses the `xlsx` library and a custom parser to read the file.
    - It analyzes the headers, suggests a column mapping based on known aliases, and returns a preview of the data to the frontend.
2.  **`POST /api/importacion-excel/confirmar`**:
    - The frontend sends back the Excel file along with the user-confirmed (or corrected) column mapping.
    - The backend processes the file in batches.
    - It uses `ON CONFLICT (numero_autorizacion) DO NOTHING` to automatically deduplicate invoices based on the unique SAT authorization number.
    - A record of the import, including a file hash, is saved to `importaciones_excel` to prevent re-importing the exact same file.

### Reconciliation Flow

1.  **`POST /api/conciliaciones`**:
    - The frontend sends a `factura_id`, `metodo_pago_id`, and `monto_aplicado`.
    - The backend inserts a new record into the `conciliaciones` table.
    - The database triggers automatically update the balances and statuses of the linked invoice and payment method.
2.  **`DELETE /api/conciliaciones/:id`**:
    - If a reconciliation is deleted, the same triggers fire, reverting the `monto_aplicado` from the respective invoice and payment method, automatically adjusting their balances and states.

## 4. Scaling Considerations

The v2.0 architecture is more robust, but scaling requires attention:

1.  **Asynchronous Processing**:
    - For large Excel files or high-volume OCR, the synchronous process can time out.
    - **Solution**: Implement a job queue (e.g., RabbitMQ, BullMQ). The initial API call adds a job to the queue and returns an immediate response. A separate worker process handles the heavy lifting (parsing, database inserts), and the frontend can poll for status updates.

2.  **Database Performance**:
    - The `conciliaciones` table will grow rapidly.
    - **Solution**: Ensure that `factura_id` and `metodo_pago_id` are indexed. The views (`v_conciliacion_detalle`) should be optimized. For very large datasets, consider partitioning the `conciliaciones` table by date.

3.  **API Security**:
    - The backend now uses the `service_role` key, which has full admin access.
    - **Solution**: Ensure that all API endpoints have robust validation and authorization checks. Never trust user input. The backend should be the ultimate gatekeeper of what is allowed. For example, ensure a user cannot reconcile an invoice that doesn't belong to their organization.

4.  **Containerization**:
    - Containerize the application using Docker to standardize the deployment environment. This simplifies scaling with orchestrators like Kubernetes or serverless container platforms.
