import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Buscamos el archivo de trades en la raíz de tu proyecto
    const filePath = path.join(process.cwd(), 'my_trades.json');

    // Si el archivo aún no existe (porque no has hecho trades), enviamos una lista vacía
    if (!fs.existsSync(filePath)) {
      return NextResponse.json([]);
    }

    // Leemos el archivo
    const data = fs.readFileSync(filePath, 'utf8');
    
    // Devolvemos los trades al dashboard
    return NextResponse.json(JSON.parse(data));

  } catch (error) {
    console.error("Error al leer el Journal local:", error);
    return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 500 });
  }
}