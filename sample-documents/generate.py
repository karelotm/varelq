"""Render the synthetic three-way sample sets (run once; outputs are committed).

Every file is SYNTHETIC: fictional supplier, fictional references, no real
customer or company data. Each document carries a visible "SYNTHETIC SAMPLE" line.

    python sample-documents/generate.py
"""
import pathlib
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / 'three-way'
W, H = 1240, 1754

SETS = {
    # id: (invoice ref, po ref, grn ref, invoice lines, po lines, grn lines)
    'short-delivery': dict(
        inv='INV-0142', po='PO-7781', grn='GRN-7781', date='2026-09-20',
        inv_lines=[('SKU-1', 'Steel bracket 40mm', 200, '12.50'), ('SKU-2', 'Hex bolt M8 zinc', 500, '0.40')],
        po_lines=[('SKU-1', 'Steel bracket 40mm', 200, '12.47'), ('SKU-2', 'Hex bolt M8 zinc', 500, '0.40')],
        grn_lines=[('SKU-1', 'Steel bracket 40mm', 180), ('SKU-2', 'Hex bolt M8 zinc', 500)]),
    'clean': dict(
        inv='INV-0143', po='PO-7782', grn='GRN-7782', date='2026-09-21',
        inv_lines=[('SKU-3', 'Pipe clamp 25mm', 120, '3.20'), ('SKU-4', 'Wall anchor 8mm', 400, '0.15')],
        po_lines=[('SKU-3', 'Pipe clamp 25mm', 120, '3.20'), ('SKU-4', 'Wall anchor 8mm', 400, '0.15')],
        grn_lines=[('SKU-3', 'Pipe clamp 25mm', 120), ('SKU-4', 'Wall anchor 8mm', 400)]),
}
SUPPLIER = 'Atlas Industrial Supply (fictional)'
BUYER = 'Carthage Fabrication SARL (fictional)'
VAT_RATE = '0.19'


def money(value):
    return f'{value:.2f}'


def font(size, mono=False, bold=False):
    names = (['consolab.ttf'] if bold else ['consola.ttf']) if mono else (['arialbd.ttf'] if bold else ['arial.ttf'])
    names += ['DejaVuSansMono.ttf' if mono else 'DejaVuSans.ttf']
    for name in names:
        for base in ('C:/Windows/Fonts/', '/usr/share/fonts/truetype/dejavu/', ''):
            try:
                return ImageFont.truetype(base + name, size)
            except OSError:
                continue
    return ImageFont.load_default(size=size)


def totals(lines):
    from decimal import Decimal
    net = sum(Decimal(q) * Decimal(p) for _, _, q, p in lines)
    vat = (net * Decimal(VAT_RATE)).quantize(Decimal('0.01'))
    return net, vat, net + vat


def render_invoice(spec, path):
    from decimal import Decimal
    image = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(image)
    ink, grey = (20, 34, 27), (95, 107, 99)
    d.rectangle([0, 0, W, 64], fill=(254, 240, 199))
    d.text((80, 18), 'SYNTHETIC SAMPLE - NOT A REAL INVOICE - VARELQ DEMO DATA', font=font(24, bold=True), fill=(181, 71, 8))
    d.text((80, 120), 'INVOICE', font=font(56, bold=True), fill=ink)
    d.text((80, 200), SUPPLIER, font=font(28, bold=True), fill=ink)
    d.text((80, 240), '12 Rue de l\'Industrie, Ben Arous, Tunisia', font=font(24), fill=grey)
    y = 320
    for label, value in (('Invoice number', spec['inv']), ('Invoice date', spec['date']),
                         ('Order reference', spec['po']), ('Bill to', BUYER), ('Currency', 'TND')):
        d.text((80, y), label, font=font(24), fill=grey)
        d.text((400, y), value, font=font(24, mono=True), fill=ink)
        y += 44
    y += 40
    d.line([80, y, W - 80, y], fill=ink, width=2)
    y += 16
    mono = font(26, mono=True)
    d.text((80, y), f'{"SKU":<7}{"Description":<22}{"Qty":>6}{"Unit price":>12}{"Amount":>11}', font=font(26, mono=True, bold=True), fill=ink)
    y += 48
    d.line([80, y, W - 80, y], fill=(197, 205, 198), width=1)
    y += 20
    for sku, desc, qty, price in spec['inv_lines']:
        amount = money(Decimal(qty) * Decimal(price))
        d.text((80, y), f'{sku:<7}{desc:<22}{qty:>6}{price:>12}{amount:>11}', font=mono, fill=ink)
        y += 56
    d.line([80, y, W - 80, y], fill=ink, width=2)
    y += 30
    net, vat, total = totals(spec['inv_lines'])
    for label, value in (('Net amount TND', money(net)), ('VAT 19% TND', money(vat)), ('Total due TND', money(total))):
        bold = label.startswith('Total')
        d.text((620, y), f'{label:<16}{value:>12}', font=font(28 if bold else 26, mono=True, bold=bold), fill=ink)
        y += 52
    d.text((80, H - 160), 'Payment terms: 30 days from invoice date.', font=font(22), fill=grey)
    d.text((80, H - 120), 'Synthetic document generated for VARELQ reconciliation tests.', font=font(22), fill=grey)
    image.save(path, format='PNG', optimize=True)


def render_po(spec):
    from decimal import Decimal
    net, vat, total = totals(spec['po_lines'])
    rows = '\n'.join(f'{sku} | {desc} | {qty} | {price} | {money(Decimal(qty) * Decimal(price))}' for sku, desc, qty, price in spec['po_lines'])
    return (f'SYNTHETIC SAMPLE - NOT A REAL PURCHASE ORDER - VARELQ DEMO DATA\n'
            f'PURCHASE ORDER {spec["po"]}\nBuyer: {BUYER}\nSupplier: {SUPPLIER}\nOrder date: 2026-09-10\nCurrency: TND\n'
            f'SKU | Description | Quantity | Unit price | Line total\n{rows}\n'
            f'Net: {money(net)} TND\nVAT rate: 19%\nVAT: {money(vat)} TND\nTotal: {money(total)} TND\n')


def render_grn(spec):
    rows = '\n'.join(f'{sku} | {desc} | {qty}' for sku, desc, qty in spec['grn_lines'])
    return (f'SYNTHETIC SAMPLE - NOT A REAL GOODS RECEIPT - VARELQ DEMO DATA\n'
            f'GOODS RECEIVED NOTE {spec["grn"]}\nOrder reference: {spec["po"]}\nSupplier: {SUPPLIER}\n'
            f'Received at: Carthage Fabrication warehouse, 2026-09-18\n'
            f'SKU | Description | Quantity received\n{rows}\nReceived by: warehouse clerk (fictional)\n')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for spec in SETS.values():
        render_invoice(spec, OUT / f'invoice-{spec["inv"].split("-")[1]}.png')
        (OUT / f'po-{spec["po"].split("-")[1]}.txt').write_text(render_po(spec), encoding='utf-8', newline='\n')
        (OUT / f'grn-{spec["grn"].split("-")[1]}.txt').write_text(render_grn(spec), encoding='utf-8', newline='\n')
    print('wrote', sorted(p.name for p in OUT.iterdir()))


if __name__ == '__main__':
    main()
