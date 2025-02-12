import { ProductosData } from '../data/productos.data.js';
import { subirImagenCloudinary } from '../utils/cloudinary.js';
import {pedidosData} from '../data/pedidos.data.js';
import {carritoData} from '../data/carrito.data.js';
import { auditoriaService } from '../services/auditoria.service.js';

export const ProductosService = {
  // Obtener todos los productos
  async getAllProductos(params) {
    try {
      const { search, categoriaId, page, pageSize, orderBy, orderDirection } = params;

      const validPage = Math.max(parseInt(page, 10) || 1, 1);
      const validPageSize = parseInt(pageSize, 10) || 0;
      const validOrderBy = ["nombre", "precio", "createdAt"].includes(orderBy) ? orderBy : "nombre";
      const validOrderDirection = ["asc", "desc"].includes(orderDirection?.toLowerCase()) ? orderDirection: "asc";

      const { productos, total } = await ProductosData.getAllProductos({
        search,
        categoriaId,
        page: validPage,
        pageSize: validPageSize,
        orderBy: validOrderBy,
        orderDirection: validOrderDirection,
      });

      // Calcular el precio con promoción para cada producto
      const productosConPromocion = productos.map((producto) => {
        let precioConPromocion = producto.precio;
        let mensajePromocion = "Producto sin promoción";

        if (
          producto.promocion &&
          this.esPromocionActiva(producto.promocion.fechaInicio, producto.promocion.fechaFin)
        ) {
          const descuento = parseFloat(producto.promocion.descuento) / 100;
          precioConPromocion =
            parseFloat(producto.precio) - parseFloat(producto.precio) * descuento;
          mensajePromocion = `Promoción activa: ${producto.promocion.nombre} (${producto.promocion.descuento}% de descuento)`;
        }

        return {
          ...producto,
          precioConPromocion: precioConPromocion.toFixed(2),
          mensajePromocion,
        };
      });

      return {
        productos: productosConPromocion,
        total,
        currentPage: validPage,
        totalPages: validPageSize > 0 ? Math.ceil(total / validPageSize) : 1,
      };
    } catch (error) {
      throw new Error(`Error al obtener los productos: ${error.message}`);
    }
  },


  // Obtener un producto por ID
  async getProductoById(id) {
    try {
        validarId(id);
        const producto = await ProductosData.getProductoById(id);
        if (!producto) {
            throw new Error('Producto no encontrado');
        }

        // 🔹 Asegurar que precioBase y ivaPorcentaje sean números válidos
        let precioBase = parseFloat(producto.precioBase) || 0;
        let ivaPorcentaje = parseFloat(producto.ivaPorcentaje) || 0;

        // 🔹 Obtener el IVA actual de la categoría si es necesario
        const ivaCategoria = await ProductosData.getIvaPorCategoria(producto.categoriaId);
        if (ivaCategoria !== null) {
            ivaPorcentaje = parseFloat(ivaCategoria);
        }

        // 🔹 Asegurar que el IVA del producto esté sincronizado con su categoría
        if (producto.ivaPorcentaje !== ivaPorcentaje) {
            await ProductosData.actualizarIvaEnProductosPorCategoria(producto.categoriaId, ivaPorcentaje);
            producto.ivaPorcentaje = ivaPorcentaje;
            producto.precio = this.calcularPrecioConIVA(precioBase, ivaPorcentaje);
        }

        // 🔹 Calcular el precio con promoción
        let precioConPromocion = parseFloat(producto.precio);
        let mensajePromocion = "Sin promoción activa para este producto.";

        if (
            producto.promocion &&
            this.esPromocionActiva(producto.promocion.fechaInicio, producto.promocion.fechaFin)
        ) {
            const descuento = parseFloat(producto.promocion.descuento) / 100;
            precioConPromocion = precioConPromocion - precioConPromocion * descuento;
            mensajePromocion = `Promoción activa: ${producto.promocion.nombre} (${producto.promocion.descuento}% de descuento).`;
        }

        return {
            ...producto,
            precioConPromocion: precioConPromocion.toFixed(2),
            mensajePromocion,
        };
    } catch (error) {
        throw new Error(`Error al obtener el producto: ${error.message}`);
    }
  },

  esPromocionActiva(fechaInicio, fechaFin) {
    const ahora = new Date();
    return (
      (!fechaInicio || new Date(fechaInicio) <= ahora) &&
      (!fechaFin || new Date(fechaFin) >= ahora)
    );
  },

  calcularPrecioConIVA(precioBase, ivaPorcentaje) {
    const iva = precioBase * (ivaPorcentaje / 100);
    return parseFloat((precioBase + iva).toFixed(2));
  },

  calcularPrecioBase(precioConIVA, ivaPorcentaje) {
    return parseFloat((precioConIVA / (1 + (ivaPorcentaje / 100))).toFixed(2));
  },


  // Crear un nuevo producto con auditoría
  async createProducto(data, usuarioId) {
    try {
        if (!usuarioId) {
            throw new Error("El usuario que realiza la acción no está autenticado.");
        }

        console.log("📥 Datos recibidos:", data);

        if (!data || !data.nombre || !data.descripcion) {
            throw new Error("El nombre y la descripción son obligatorios");
        }

        data.precioBase = parseFloat(data.precioBase);
        data.stock = parseInt(data.stock, 10);
        data.categoriaId = parseInt(data.categoriaId, 10);
        data.promocionId = data.promocionId ? parseInt(data.promocionId, 10) : null;
        data.ivaPorcentaje = data.ivaPorcentaje ? parseFloat(data.ivaPorcentaje) : 0;

        // ✅ Calcular el precio final con IVA
        const precioConIVA = data.precioBase * (1 + data.ivaPorcentaje / 100);
        data.precio = parseFloat(precioConIVA.toFixed(2));

        // ✅ Declarar imageUrl correctamente ANTES de su uso
        let imageUrl = "";

        // 🔹 Verificar si se envió una imagen local
        if (data.imagenLocalPath) {
            console.log("📤 Subiendo imagen a Cloudinary...");
            try {
                imageUrl = await subirImagenCloudinary(data.imagenLocalPath, "productos");
                console.log("✅ Imagen subida correctamente:", imageUrl);
            } catch (error) {
                console.error("❌ Error al subir imagen a Cloudinary:", error);
                throw new Error("Error al subir imagen. Intenta nuevamente.");
            }
        }

        // 🔹 Si sigue sin haber imagen, asignar una predeterminada
        if (!imageUrl) {
            imageUrl = "https://res.cloudinary.com/demo/image/upload/default-product.png"; // Imagen predeterminada
            console.log("📌 Se asignó una imagen predeterminada:", imageUrl);
        }

        // ✅ Asegurar que data.imagen tenga un valor antes de guardar
        data.imagen = imageUrl;

        console.log("📤 Datos a guardar en la base de datos:", {
            ...data,
            imagen: imageUrl,
        });

        // ✅ Evita errores con Prisma asegurando que todos los valores están bien formateados
        const nuevoProducto = await ProductosData.createProducto({
            nombre: data.nombre,
            descripcion: data.descripcion,
            precioBase: data.precioBase,
            precio: data.precio,
            stock: data.stock,
            categoriaId: data.categoriaId,
            promocionId: data.promocionId ? parseInt(data.promocionId, 10) : 6,
            especificaciones: data.especificaciones,
            marca: data.marca,
            garantia: data.garantia,
            ivaPorcentaje: data.ivaPorcentaje,
            imagen: data.imagen,  // 🔹 Se usa el `imageUrl` correctamente definido
        });

        // 🔹 Registrar evento de auditoría
        await auditoriaService.registrarEvento(
            usuarioId,
            "productos",
            "CREAR",
            nuevoProducto
        );

        console.log("✅ Producto creado correctamente:");

        return nuevoProducto;
    } catch (error) {
        console.error("❌ Error al crear producto:", error.message);
        throw new Error(`Error al crear producto: ${error.message}`);
    }
  },   

  // Actualizar Producto
  async updateProducto(id, data, usuarioId) {
    try {
        validarId(id);
        if (!data || Object.keys(data).length === 0) {
            throw new Error("Los datos para actualizar el producto no pueden estar vacíos");
        }
        if (!usuarioId) {
            throw new Error("El usuario que realiza la acción no está autenticado.");
        }

        const productoActual = await ProductosData.getProductoById(id);
        if (!productoActual) {
            throw new Error("Producto no encontrado");
        }

        // 🔹 Verificar si se está enviando `ivaPorcentaje`, si no, usar el actual
        let ivaPorcentaje = data.ivaPorcentaje !== undefined && data.ivaPorcentaje !== null
            ? parseFloat(data.ivaPorcentaje)
            : parseFloat(productoActual.ivaPorcentaje);

        // 🔹 Asegurar que `ivaPorcentaje` es un número válido
        if (isNaN(ivaPorcentaje) || ivaPorcentaje < 0) {
            throw new Error("El IVA debe ser un número válido y positivo.");
        }

        let precioBase = data.precioBase !== undefined && data.precioBase !== null
            ? parseFloat(data.precioBase)
            : parseFloat(productoActual.precioBase);

        let precioConIVA = parseFloat((precioBase * (1 + ivaPorcentaje / 100)).toFixed(2));

        // 🔹 Permitir `promocionId` como `null` si no se envía
        let promocionId = data.promocionId !== undefined && data.promocionId !== null
            ? parseInt(data.promocionId, 10)
            : null; // 🔥 Ahora permite null

        console.log(`📌 Actualizando producto ID ${id}: Precio Base: ${precioBase}, IVA: ${ivaPorcentaje}%, Precio Final: ${precioConIVA}, Promoción: ${promocionId}`);

        const dataActualizada = {
            ...data,
            precioBase,
            precio: precioConIVA,
            ivaPorcentaje,
            promocionId
        };

        // 🔹 🔥 Asegurar que Prisma actualiza correctamente
        const productoActualizado = await ProductosData.updateProducto(id, dataActualizada);

        await auditoriaService.registrarEvento(
            usuarioId,
            "productos",
            "ACTUALIZAR",
            { id, cambios: dataActualizada }
        );

        return productoActualizado;
    } catch (error) {
        console.error("❌ Error al actualizar el producto:", error.message);
        throw new Error(`Error al actualizar el producto: ${error.message}`);
    }
  },


  // Eliminar un producto con auditoría
  async deleteProducto(id, usuarioId) {
    try {
      validarId(id);
      if (!usuarioId) {
        throw new Error("El usuario que realiza la acción no está autenticado.");
      }
  
      const productoEliminado = await ProductosData.getProductoById(id);
      if (!productoEliminado) {
        throw new Error("Producto no encontrado");
      }
  
      const pedidosRelacionados = await pedidosData.getPedidosByProductoId(id);
      if (pedidosRelacionados.length > 0) {
        throw new Error(`No se puede eliminar el producto. Está en ${pedidosRelacionados.length} pedido(s).`);
      }
  
      const carritosRelacionados = await carritoData.getCarritosByProductoId(id);
      if (carritosRelacionados.length > 0) {
        throw new Error(`No se puede eliminar el producto. Está en ${carritosRelacionados.length} carrito(s).`);
      }
  
      await ProductosData.deleteProducto(id);
  
      await auditoriaService.registrarEvento(
        usuarioId,
        "productos",
        "ELIMINAR",
        productoEliminado
      );
  
      return { message: "Producto eliminado exitosamente" };
    } catch (error) {
      throw new Error(`Error al eliminar el producto: ${error.message}`);
    }
  },

  async buscarProductos(termino, limit = 5) {
    if (!termino || termino.length < 2) {
      throw new Error("El término de búsqueda debe tener al menos 2 caracteres.");
    }
  
    return await ProductosData.buscarProductosPorNombreOCategoria(termino, limit);
  }
  
};

function validarId(id) {
  if (typeof id !== 'number' || isNaN(id)) {
    throw new Error('El ID debe ser un número válido');
  }
}