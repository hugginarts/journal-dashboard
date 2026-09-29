import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req) {
  try {
    const newTrades = await req.json();
    const filePath = path.join(process.cwd(), 'my_trades.json');
    const sanitizedTrades = newTrades.map(t => ({
      ...t,
      profit: parseFloat(t.profit) || 0,
      price: parseFloat(t.price) || 0,
      missedProfit: 0
    }));
    let existingData = [];
    if (fs.existsSync(filePath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) { existingData = []; }
    }
    const updatedData = [...sanitizedTrades, ...existingData];
    fs.writeFileSync(filePath, JSON.stringify(updatedData, null, 2));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}