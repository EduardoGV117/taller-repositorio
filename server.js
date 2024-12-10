const { format } = require('date-fns');
const express = require('express');
const { Client } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');

const app = express();
const port = 3000;

// Lista de correos permitidos
const allowedEmails = ['vejar001@gmail.com', 'l20212934@tectijuana.edu.mx', 'yahir.sanchez201@tectijuana.edu.mx', 'victor.millan19@tectijuana.edu.mx', 'l20212407@tectijuana.edu.mx'];

// Configurar el cliente PostgreSQL
const client = new Client({
  user: 'postgres',
  host: '35.208.24.98',
  database: 'gestion_inventario',
  password: 'bajacar',
  port: 5432,
});

client.connect();

app.use(bodyParser.json());
app.use(express.static('public'));



// API para agregar producto
app.post('/productos/insertar-producto', async (req, res) => {
  const { nombre_producto, categoria, precio_compra, precio_venta, stock_actual, descripcion } = req.body;
  try {
    const result = await client.query(
      'INSERT INTO Productos (nombre_producto, categoria, precio_compra, precio_venta, stock_actual, descripcion) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [nombre_producto, categoria, precio_compra, precio_venta, stock_actual, descripcion]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al agregar el producto');
  }
});

// Otras APIs (protegidas)
app.get('/productos', async (req, res) => {
  try {
    const result = await client.query('SELECT * FROM productos');
    res.json(result.rows); // Devuelve los datos como JSON
  } catch (err) {
    console.error('Error al obtener los productos:', err);
    res.status(500).send('Error al obtener los productos');
  }
});

// Ruta para buscar productos
app.get('/productos/buscar', async (req, res) => {
  const { nombre_producto } = req.query;
  try {
    const result = await client.query('SELECT * FROM Productos WHERE nombre_producto ILIKE $1', [`%${nombre_producto}%`]);
    res.json(result.rows); // Devuelve los productos encontrados como JSON
  } catch (error) {
    console.error('Error al buscar productos:', error);
    res.status(500).json({ error: 'Error al buscar productos' });
  }
});
// Ruta para actualizar el stock de un producto
app.post('/productos/actualizar-stock', async (req, res) => {
  const { id_producto, cantidad } = req.body;
  try {
      await client.query('UPDATE Productos SET stock_actual = stock_actual + $1 WHERE id_producto = $2', [cantidad, id_producto]);
      res.json({ success: true });
  } catch (error) {
      res.json({ success: false, error: error.message });
  }
});

// Ruta para eliminar un producto
app.delete('/productos/eliminar', async (req, res) => {
  const { id_producto } = req.body;
  try {
      await pool.query('DELETE FROM Productos WHERE id_producto = $1', [id_producto]);
      res.json({ success: true });
  } catch (error) {
      res.json({ success: false, error: error.message });
  }
});

app.post('/ventas', async (req, res) => {
  const { invoiceId, productos } = req.body;  // invoiceId es proporcionado por el proveedor
  const descripcion = req.body.descripcion;   // Descripción opcional para la factura

  try {
    await client.query('BEGIN'); // Iniciar transacción

    // Insertar la factura en la tabla `facturas`
    const facturaResult = await client.query(
      'INSERT INTO facturas (id_factura_proveedor, descripcion) VALUES ($1, $2) RETURNING id_factura',
      [invoiceId, descripcion]  // Usamos `invoiceId` para id_factura_proveedor
    );

    const idFactura = facturaResult.rows[0].id_factura; // Obtener el id_factura generado automáticamente

    // Procesar cada producto en la venta/baja
    for (const producto of productos) {
      // Reducir el stock en el inventario
      const resultadoInventario = await client.query(
        'UPDATE productos SET stock_actual = stock_actual - $1 WHERE id_producto = $2 AND stock_actual >= $1 RETURNING id_producto, stock_actual',
        [producto.cantidad, producto.id_producto]
      );

      if (resultadoInventario.rows.length === 0) {
        throw new Error(`No hay suficiente stock para el producto ID: ${producto.id_producto}`);
      }

      // Registrar la venta/baja en `detalle_factura`
      await client.query(
        'INSERT INTO detalle_factura (id_factura, id_producto, cantidad, descripcion) VALUES ($1, $2, $3, $4)',
        [idFactura, producto.id_producto, producto.cantidad, producto.descripcion]
      );
    }

    await client.query('COMMIT'); // Confirmar transacción

    res.status(200).send('Venta/Baja registrada correctamente.');
  } catch (error) {
    await client.query('ROLLBACK'); // Revertir transacción en caso de error
    console.error('Error al registrar la venta/baja:', error);
    res.status(500).send('Error al registrar la venta/baja.');
  }
});


app.get('/productos', async (req, res) => {
  const mes = req.query.mes;  // Mes seleccionado como número ajsute aqui para poder cargar
  const año = new Date().getFullYear();  // Año actual
  
  try {
    const query = `
      SELECT id_producto, nombre_producto, categoria,
             CAST(precio_compra AS FLOAT) AS precio_compra,
             CAST(precio_venta AS FLOAT) AS precio_venta,
             stock_actual, descripcion, fecha_creacion, fecha_actualizacion,
             CASE 
               WHEN TO_CHAR(fecha_creacion AT TIME ZONE 'UTC', 'YYYY-MM') = $1 THEN 'insertado'
               WHEN TO_CHAR(fecha_actualizacion AT TIME ZONE 'UTC', 'YYYY-MM') = $1 THEN 'actualizado'
               ELSE NULL
             END AS tipo_cambio
      FROM productos
      WHERE TO_CHAR(fecha_creacion AT TIME ZONE 'UTC', 'YYYY-MM') = $1
         OR TO_CHAR(fecha_actualizacion AT TIME ZONE 'UTC', 'YYYY-MM') = $1
    `;
    const filtro = `${año}-${mes.padStart(2, '0')}`;  // Formato 'YYYY-MM' para comparar
    const result = await client.query(query, [filtro]);  // Pasar el filtro como parámetro
    console.log('Filtro aplicado:', filtro);  // Verifica que el filtro tenga el formato correcto
    console.log('Productos filtrados:', result.rows);  // Verifica los datos antes de enviarlos
    res.json(result.rows);  // Devolver los productos filtrados
  } catch (err) {
    console.error('Error al obtener los productos:', err);
    res.status(500).send('Error al obtener los productos');
  }
});
app.get('/reporte-ventas',  async (req, res) => {
  const { mes, año } = req.query; // Obtener mes y año desde la solicitud

  try {
    const result = await client.query(
      `SELECT f.id_factura_proveedor, 
              TO_CHAR(f.fecha, 'DD/MM/YYYY') AS fecha_factura,  -- Fecha formateada
              df.id_producto, 
              p.nombre_producto, 
              df.cantidad, 
              df.descripcion, 
              p.precio_venta, 
              df.cantidad * p.precio_venta AS total_venta
       FROM facturas f
       JOIN detalle_factura df ON f.id_factura = df.id_factura
       JOIN productos p ON df.id_producto = p.id_producto
       WHERE EXTRACT(MONTH FROM f.fecha) = $1 AND EXTRACT(YEAR FROM f.fecha) = $2
       ORDER BY f.fecha DESC`,
      [mes, año]
    );

    res.json(result.rows); // Devolver los resultados como respuesta
  } catch (error) {
    console.error('Error al obtener el reporte de ventas:', error);
    res.status(500).send('Error al obtener el reporte de ventas.');
  }
});


// Iniciar servidor
app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor escuchando en http://0.0.0.0:${port}`);
});