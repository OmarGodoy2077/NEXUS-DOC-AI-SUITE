# NEXUS DOC AI SUITE v2.0

NEXUS DOC AI SUITE is a powerful, open-source platform for intelligent document processing, semantic search, and financial reconciliation. It allows you to upload financial documents (invoices, receipts), extract structured data using AI, import official tax documents (like SAT DTE-FEL from Guatemala), and manage complex payment reconciliations.

This project is designed to be a robust starting point for building your own financial and document intelligence solutions. It's built with a modern technology stack and is designed to be scalable and customizable.

## Features

- **Document Upload & OCR:** Upload PDF, PNG, or JPG files (cheques, transfers) for processing. Text is automatically extracted using Tesseract.js.
- **AI-Powered Data Extraction:** Uses a local multimodal model (**MiniCPM-V**) to analyze images of documents like checks and extract structured data directly, replacing traditional OCR.
- **SAT DTE-FEL Excel Import:** A powerful two-step parser for importing invoices directly from the Excel files provided by the Guatemalan Tax Authority (SAT). It handles dynamic column mapping and prevents duplicate imports.
- **Advanced Reconciliation Engine:**
    - Supports many-to-many relationships between invoices and payment methods.
    - A single payment can cover multiple invoices.
    - A single invoice can be paid with multiple partial payments.
- **Automated State & Balance Management:** The database uses triggers and generated columns to automatically update invoice statuses (`pending`, `partial`, `paid`) and payment balances, ensuring data integrity.
- **Supabase Integration:** Uses Supabase for its powerful PostgreSQL database (including triggers and functions) and file storage.
- **Modern Frontend:** A clean and responsive user interface built with React, Vite, and Tailwind CSS, including an image cropper to improve OCR accuracy.

## Technology Stack

- **Frontend:**
  - React 18
  - Vite
  - Tailwind CSS
  - React Router
  - **react-image-crop** for the image cropper UI
  - Supabase Client JS
- **Backend:**
  - Node.js
  - Express
  - Supabase Client JS (using Service Role for admin tasks)
  - Multer for file uploads
- **AI:**
  - **MiniCPM-V** (via Ollama) for multimodal document analysis (image-to-text), known for superior performance in text-heavy image extraction.

## Project Setup from Scratch

Follow these steps to get the project up and running on your local machine.

### 1. Prerequisites

- **Node.js:** Make sure you have Node.js version 18.x or higher installed.
- **Ollama:** You need to have Ollama installed to run the local AI model. You can download it from [https://ollama.com/](https://ollama.com/).

### 2. Clone the Repository

```bash
git clone <your-repository-url>
cd <your-repository-folder>
```

### 3. Set up the AI Model (MiniCPM-V)

After installing Ollama, you need to download the MiniCPM-V model. Open your terminal and run:

```bash
ollama pull minicpm-v
```
This will download the model to your local machine. Ensure the Ollama service is running before starting the backend.

### 4. Set up Supabase

1.  Go to [Supabase](https://supabase.com/) and create a new project.
2.  **Database Setup**: Go to the **SQL Editor** and execute the SQL script located in `backend/sql/schema.sql` (Note: This file needs to be created based on the technical documentation). This will create the `facturas`, `metodos_pago`, `conciliaciones`, and `importaciones_excel` tables, along with the necessary triggers and functions.
3.  **Storage Setup**: In your Supabase project, go to the **Storage** section and create two new buckets:
    - `comprobantes` (for OCR uploads like checks)
    - `sat-excel-imports` (for the uploaded SAT Excel files)
4.  **API Keys**: Go to **Project Settings** > **API**. You will need:
    - **Project URL**
    - **`anon` key** (for the frontend)
    - **`service_role` key** (for the backend, as it performs admin-level tasks)

### 5. Configure the Backend

1.  Navigate to the `backend` directory:
    ```bash
    cd backend
    ```
2.  Install the dependencies. Note that `tesseract.js` is no longer needed.
    ```bash
    npm install
    ```
3.  Create a `.env` file in the `backend` directory and add the following, replacing the placeholders with your Supabase credentials:
    ```
    PORT=3000
    SUPABASE_URL=your-supabase-project-url
    SUPABASE_KEY=your-supabase-service-role-key
    ```
4.  Start the backend server:
    ```bash
    npm run dev
    ```

### 6. Configure the Frontend

1.  Navigate to the `frontend` directory:
    ```bash
    cd ../frontend
    ```
2.  Install the dependencies, including the new image cropper library:
    ```bash
    npm install react-image-crop
    ```
3.  Create a `.env` file in the `frontend` directory and add the following:
    ```
    VITE_API_URL=http://localhost:3000/api
    VITE_SUPABASE_URL=your-supabase-project-url
    VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
    ```
4.  Start the frontend development server:
    ```bash
    npm run dev
    ```

## User Flow

1.  **Import Invoices:** The user goes to the "Import SAT" page, uploads an Excel file with invoices, verifies the column mapping, and confirms the import. The backend processes the file, ignoring any duplicates.
2.  **Upload Payments:** The user goes to the "Upload" page, uploads an image of a payment document (like a check). They can then crop the image to focus on the relevant areas. Upon confirmation, the cropped image is sent to the backend. The LLaVA model analyzes the image and creates a new payment method with the extracted data and an available balance.
3.  **Reconcile:** On the "Reconciliation" page, the user can:
    - Select an unpaid invoice.
    - Select an available payment method.
    - Apply a full or partial amount from the payment to the invoice.
4.  **View Dashboards:** The user can view dashboards and reports showing the status of all invoices, available balances on payment methods, and reconciliation history.

---
*This README was updated by an AI assistant to reflect the v2.0 architecture and features.*
