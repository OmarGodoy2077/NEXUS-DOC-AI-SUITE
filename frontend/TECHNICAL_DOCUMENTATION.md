# Frontend Technical Documentation - NEXUS DOC AI SUITE v2.0

This document provides a technical overview of the v2.0 frontend application, its architecture, and key implementation details related to the new financial reconciliation features.

## 1. Architecture Overview

The frontend remains a React single-page application (SPA) built with Vite and styled with Tailwind CSS. However, its complexity has grown to support the new v2.0 features.

### Core Components & Structure:

- **`main.jsx`**: Application entry point.
- **`App.jsx`**: Manages top-level routing and context providers.
- **`src/pages`**: Contains components for each major feature area:
  - `Dashboard.jsx`: Displays key metrics and summaries.
  - `ImportarSAT.jsx`: A new page dedicated to the two-step Excel import process.
  - `Conciliacion.jsx`: A new, complex page for managing the reconciliation between invoices and payments.
  - `Facturas.jsx`, `MetodosPago.jsx`: Pages for listing and managing invoices and payment methods.
- **`src/components`**: Reusable UI components. The `ui` folder contains generic elements (`Button`, `Card`), while the `layout` folder contains structural components (`Header`, `Sidebar`). New components for v2.0 might include data tables, modals for reconciliation, and file uploaders with mapping previews.
- **`src/context/AppContext.jsx`**: The React Context provider is now more critical, managing shared state like lists of invoices, payment methods, and potentially the state of the current reconciliation process.
- **`src/services/api.js`**: Expanded to include functions for all new v2.0 API endpoints, such as `analizarExcel`, `confirmarImportacion`, `crearConciliacion`, etc.

## 2. State Management

With the added complexity, state management becomes more important.

- **`AppContext`**: Continues to be used for global state that is shared across many components (e.g., user info, general notifications).
- **Local Component State (`useState`, `useReducer`)**: For state that is specific to a single page or component, local state is preferred. For example:
  - The `ImportarSAT.jsx` page will manage the state of the file upload, the suggested column mapping, and the data preview locally.
  - The `Conciliacion.jsx` modal will manage the selected invoice, selected payment method, and the amount to apply.
- **Data Fetching & Caching**: For fetching, caching, and re-fetching data from the API, using a dedicated data-fetching library like **React Query (TanStack Query)** or **SWR** is highly recommended. This simplifies loading and error states, reduces boilerplate `useEffect` code, and improves user experience by caching data.

## 3. Key Feature Implementations

### SAT Excel Import Page (`ImportarSAT.jsx`)

This page implements the two-step import process:

1.  **Step 1: Analysis**
    - A file input component allows the user to select an Excel file.
    - On selection, the `api.analizarExcel` function is called.
    - The component displays a loading state while the backend analyzes the file.
    - On success, the component receives and stores the suggested mapping and a data preview in its local state. It then renders a table showing the preview and a form allowing the user to review and edit the column mapping.
2.  **Step 2: Confirmation**
    - A "Confirm Import" button is enabled once the file is analyzed.
    - When clicked, the `api.confirmarImportacion` function is called, sending the original file and the final (user-approved) mapping.
    - The UI shows a progress indicator for the import.
    - On completion, a success or error notification is displayed, and the user is redirected to the invoices list or dashboard.

### Reconciliation Page/Modal (`Conciliacion.jsx`)

This is the most interactive part of the new frontend.

1.  **UI Structure**: It likely consists of two main sections or searchable dropdowns: one for selecting an unpaid/partially paid invoice and another for selecting an available payment method.
2.  **Data Fetching**: It fetches lists of invoices (with `estado=pendiente` or `estado=parcial`) and payment methods (with `estado=disponible` or `estado=utilizado_parcial`) from the API.
3.  **State Management**: It manages the state for:
    - The selected invoice (`selectedFactura`).
    - The selected payment method (`selectedMetodoPago`).
    - The amount to apply (`montoAplicar`), which is an input field.
4.  **Logic and Validation**:
    - The `montoAplicar` input is validated to ensure it is not greater than the invoice's `saldo_pendiente` or the payment's `saldo_disponible`.
    - The "Reconcile" button is disabled until all required fields are filled and valid.
5.  **API Call**:
    - On submit, it calls the `api.crearConciliacion` function with the IDs of the selected items and the amount.
    - After a successful API call, it should trigger a re-fetch of the invoice and payment data to update the UI with the new balances and statuses. Using a library like React Query would make this re-fetching process declarative and simple.

## 4. Scaling and Best Practices

1.  **Component Granularity**: Break down complex pages like `Conciliacion.jsx` into smaller, manageable components (e.g., `InvoiceSelector`, `PaymentSelector`, `AmountInput`).
2.  **Custom Hooks**: Encapsulate complex logic into custom hooks. For example, a `useReconciliation` hook could manage the state and logic for the reconciliation modal. A `useExcelImport` hook could manage the state for the import page.
3.  **Forms**: For complex forms with validation (like the reconciliation modal), use a dedicated form library like **React Hook Form** or **Formik** to reduce boilerplate and handle validation efficiently.
4.  **Testing**:
    - **Unit Tests**: Write tests for custom hooks and complex utility functions.
    - **Component Tests**: Use React Testing Library to test individual components, especially those with user interaction like the reconciliation modal.
    - **End-to-End Tests**: Use Cypress or Playwright to test the full user flows, such as uploading an Excel file and completing a reconciliation.
