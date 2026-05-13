import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/layout/Layout';
import { Login }         from './pages/Login';
import { Dashboard }     from './pages/Dashboard';
import { Facturas }      from './pages/Facturas';
import { MetodosPago }   from './pages/MetodosPago';
import { Conciliacion }  from './pages/Conciliacion';
import { ImportarExcel } from './pages/ImportarExcel';
import { Upload }        from './pages/Upload';
import { Admin }         from './pages/Admin';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/facturas"      element={<Facturas />} />
            <Route path="/metodos-pago"  element={<MetodosPago />} />
            <Route path="/conciliacion"  element={<Conciliacion />} />
            <Route path="/importar-excel" element={<ImportarExcel />} />
            <Route path="/upload"        element={<Upload />} />
            <Route path="/admin"         element={<Admin />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
