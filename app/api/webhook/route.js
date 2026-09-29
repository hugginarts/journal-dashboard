import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req) {
  try {
    const data = await req.json();
    const filePath = path.join(process.cwd(), 'my_trades.json');

    const newTrade = {
      id: Date.now(),
      pair: data.pair || 'MNQ',
      type: data.type || 'BUY',
      price: parseFloat(data.price),
      target: parseFloat(data.target), // Tu TP planeado
      sl: parseFloat(data.sl),         // Tu SL planeado
      exitPrice: data.exitPrice || null, // Se llenará al cerrar el trade
      result: 'PENDING',
      missedProfit: 0,
      time: new Date().toLocaleTimeString()
    };

    const fileData = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : [];
    fileData.unshift(newTrade);
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}