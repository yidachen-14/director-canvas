/**
 * Named colours for swatch cards: traditional Chinese colour names in the
 * Chinese interface, the CSS colour names in English. Only the hex value is
 * stored on a card; its name is looked up from the nearest entry here.
 */
export interface NamedColor { name: string; hex: string; }

export const ZH_COLORS: NamedColor[] = [
  // 紅
  { name: '胭脂', hex: '#9D2933' }, { name: '朱砂', hex: '#FF461F' }, { name: '朱紅', hex: '#FF4C00' }, { name: '丹', hex: '#FF4E20' },
  { name: '緋紅', hex: '#C83C23' }, { name: '酡紅', hex: '#DC3023' }, { name: '石榴紅', hex: '#F20C00' }, { name: '海棠紅', hex: '#DB5A6B' },
  { name: '桃紅', hex: '#F47983' }, { name: '嫣紅', hex: '#EF7A82' }, { name: '粉紅', hex: '#FFB3A7' }, { name: '妃色', hex: '#ED5736' },
  { name: '品紅', hex: '#F00056' }, { name: '洋紅', hex: '#FF4777' }, { name: '銀紅', hex: '#F05654' }, { name: '茜色', hex: '#CB3A56' },
  { name: '殷紅', hex: '#BE002F' }, { name: '棗紅', hex: '#C32136' }, { name: '絳紫', hex: '#8C4356' }, { name: '紫檀', hex: '#4C221B' },
  { name: '檀', hex: '#B36D61' }, { name: '藕荷', hex: '#E4C6D0' }, { name: '藕色', hex: '#EDD1D8' }, { name: '水紅', hex: '#F3D3E7' },
  // 橙、黃、褐
  { name: '橙黃', hex: '#FFA400' }, { name: '橘黃', hex: '#FF8936' }, { name: '杏黃', hex: '#FFA631' }, { name: '橙色', hex: '#FA8C35' },
  { name: '杏紅', hex: '#FF8C31' }, { name: '雌黃', hex: '#FFC64B' }, { name: '藤黃', hex: '#FFB61E' }, { name: '鵝黃', hex: '#FFF143' },
  { name: '鴨黃', hex: '#FAFF72' }, { name: '薑黃', hex: '#FFC773' }, { name: '緗色', hex: '#F0C239' }, { name: '秋香色', hex: '#D9B611' },
  { name: '柘黃', hex: '#C89B40' }, { name: '黃櫨', hex: '#E29C45' }, { name: '琥珀', hex: '#CA6924' }, { name: '金色', hex: '#EACD76' },
  { name: '赤金', hex: '#F2BE45' }, { name: '牙色', hex: '#EEDEB0' }, { name: '駝色', hex: '#A88462' }, { name: '秋色', hex: '#896C39' },
  { name: '棕色', hex: '#B25D25' }, { name: '赭', hex: '#9C5333' }, { name: '赭石', hex: '#845A33' }, { name: '棕黑', hex: '#7C4B00' },
  { name: '褐色', hex: '#6E511E' }, { name: '咖啡', hex: '#6F4E37' },
  // 綠
  { name: '松花綠', hex: '#057748' }, { name: '松柏綠', hex: '#21A675' }, { name: '竹青', hex: '#789262' }, { name: '嫩綠', hex: '#BDDD22' },
  { name: '柳綠', hex: '#AFDD22' }, { name: '蔥綠', hex: '#0EB83A' }, { name: '碧色', hex: '#1BD1A5' }, { name: '青碧', hex: '#48C0A3' },
  { name: '翡翠', hex: '#3DE1AD' }, { name: '玉色', hex: '#2EDFA3' }, { name: '石綠', hex: '#16A951' }, { name: '銅綠', hex: '#549688' },
  { name: '豆綠', hex: '#9ED048' }, { name: '油綠', hex: '#00BC12' }, { name: '艾綠', hex: '#A4E2C6' }, { name: '蒼綠', hex: '#519A73' },
  { name: '黛綠', hex: '#426666' }, { name: '綠沈', hex: '#0C8918' }, { name: '松花', hex: '#BCE672' }, { name: '墨綠', hex: '#2E4B3C' },
  // 藍、青
  { name: '靛青', hex: '#177CB0' }, { name: '靛藍', hex: '#065279' }, { name: '藍', hex: '#44CEF6' }, { name: '碧藍', hex: '#3EEDE7' },
  { name: '蔚藍', hex: '#70F3FF' }, { name: '寶藍', hex: '#4B5CC4' }, { name: '藏藍', hex: '#3B2E7E' }, { name: '藏青', hex: '#2E4E7E' },
  { name: '群青', hex: '#4C8DAE' }, { name: '湖藍', hex: '#30DFF3' }, { name: '花青', hex: '#003472' }, { name: '黛藍', hex: '#425066' },
  { name: '石青', hex: '#1685A9' }, { name: '天青', hex: '#8CB5D2' }, { name: '月白', hex: '#D6ECF0' }, { name: '蒼色', hex: '#75878A' },
  { name: '鴨卵青', hex: '#E0EEE8' }, { name: '水綠', hex: '#D4F2E7' },
  // 紫
  { name: '紫色', hex: '#8D4BBB' }, { name: '丁香', hex: '#CCA4E3' }, { name: '雪青', hex: '#B0A4E3' }, { name: '青蓮', hex: '#801DAE' },
  { name: '黛紫', hex: '#574266' }, { name: '紫醬', hex: '#815463' }, { name: '醬紫', hex: '#815476' }, { name: '紫棠', hex: '#56004F' },
  { name: '藕紫', hex: '#A88BA8' }, { name: '黛', hex: '#4A4266' },
  // 黑、白、灰
  { name: '玄色', hex: '#622A1D' }, { name: '漆黑', hex: '#161823' }, { name: '烏黑', hex: '#392F41' }, { name: '墨色', hex: '#50616D' },
  { name: '煤黑', hex: '#312520' }, { name: '鴉青', hex: '#424C50' }, { name: '玄青', hex: '#3D3B4F' }, { name: '純黑', hex: '#000000' },
  { name: '鉛灰', hex: '#6B6B6B' }, { name: '灰色', hex: '#808080' }, { name: '蒼白', hex: '#D1D9E0' }, { name: '銀灰', hex: '#B9B9B9' },
  { name: '銀白', hex: '#E9E7EF' }, { name: '精白', hex: '#FFFFFF' }, { name: '象牙白', hex: '#FFFBF0' }, { name: '雪白', hex: '#F0FCFF' },
  { name: '縞', hex: '#F2ECDE' }, { name: '素', hex: '#E0F0E9' }, { name: '茶白', hex: '#F3F9F1' }, { name: '魚肚白', hex: '#FCEFE8' },
];

export const EN_COLORS: NamedColor[] = [
  ['Black', '#000000'], ['Dim Gray', '#696969'], ['Gray', '#808080'], ['Dark Gray', '#A9A9A9'], ['Silver', '#C0C0C0'], ['Light Gray', '#D3D3D3'],
  ['Gainsboro', '#DCDCDC'], ['White Smoke', '#F5F5F5'], ['White', '#FFFFFF'], ['Snow', '#FFFAFA'], ['Ivory', '#FFFFF0'], ['Linen', '#FAF0E6'],
  ['Beige', '#F5F5DC'], ['Old Lace', '#FDF5E6'], ['Seashell', '#FFF5EE'], ['Cornsilk', '#FFF8DC'], ['Lemon Chiffon', '#FFFACD'], ['Wheat', '#F5DEB3'],
  ['Maroon', '#800000'], ['Dark Red', '#8B0000'], ['Brown', '#A52A2A'], ['Firebrick', '#B22222'], ['Crimson', '#DC143C'], ['Red', '#FF0000'],
  ['Tomato', '#FF6347'], ['Coral', '#FF7F50'], ['Indian Red', '#CD5C5C'], ['Light Coral', '#F08080'], ['Dark Salmon', '#E9967A'], ['Salmon', '#FA8072'],
  ['Light Salmon', '#FFA07A'], ['Orange Red', '#FF4500'], ['Dark Orange', '#FF8C00'], ['Orange', '#FFA500'], ['Gold', '#FFD700'], ['Goldenrod', '#DAA520'],
  ['Dark Goldenrod', '#B8860B'], ['Khaki', '#F0E68C'], ['Dark Khaki', '#BDB76B'], ['Yellow', '#FFFF00'], ['Light Yellow', '#FFFFE0'], ['Moccasin', '#FFE4B5'],
  ['Peach Puff', '#FFDAB9'], ['Navajo White', '#FFDEAD'], ['Burlywood', '#DEB887'], ['Tan', '#D2B48C'], ['Rosy Brown', '#BC8F8F'], ['Sandy Brown', '#F4A460'],
  ['Peru', '#CD853F'], ['Chocolate', '#D2691E'], ['Sienna', '#A0522D'], ['Saddle Brown', '#8B4513'], ['Olive', '#808000'], ['Olive Drab', '#6B8E23'],
  ['Dark Olive Green', '#556B2F'], ['Yellow Green', '#9ACD32'], ['Lawn Green', '#7CFC00'], ['Chartreuse', '#7FFF00'], ['Green Yellow', '#ADFF2F'], ['Lime', '#00FF00'],
  ['Lime Green', '#32CD32'], ['Pale Green', '#98FB98'], ['Light Green', '#90EE90'], ['Medium Spring Green', '#00FA9A'], ['Spring Green', '#00FF7F'], ['Medium Sea Green', '#3CB371'],
  ['Sea Green', '#2E8B57'], ['Forest Green', '#228B22'], ['Green', '#008000'], ['Dark Green', '#006400'], ['Dark Sea Green', '#8FBC8F'], ['Medium Aquamarine', '#66CDAA'],
  ['Aquamarine', '#7FFFD4'], ['Turquoise', '#40E0D0'], ['Medium Turquoise', '#48D1CC'], ['Dark Turquoise', '#00CED1'], ['Light Sea Green', '#20B2AA'], ['Teal', '#008080'],
  ['Dark Cyan', '#008B8B'], ['Cyan', '#00FFFF'], ['Light Cyan', '#E0FFFF'], ['Pale Turquoise', '#AFEEEE'], ['Cadet Blue', '#5F9EA0'], ['Powder Blue', '#B0E0E6'],
  ['Light Blue', '#ADD8E6'], ['Sky Blue', '#87CEEB'], ['Light Sky Blue', '#87CEFA'], ['Deep Sky Blue', '#00BFFF'], ['Dodger Blue', '#1E90FF'], ['Cornflower Blue', '#6495ED'],
  ['Steel Blue', '#4682B4'], ['Light Steel Blue', '#B0C4DE'], ['Royal Blue', '#4169E1'], ['Blue', '#0000FF'], ['Medium Blue', '#0000CD'], ['Dark Blue', '#00008B'],
  ['Navy', '#000080'], ['Midnight Blue', '#191970'], ['Slate Blue', '#6A5ACD'], ['Dark Slate Blue', '#483D8B'], ['Medium Slate Blue', '#7B68EE'], ['Medium Purple', '#9370DB'],
  ['Rebecca Purple', '#663399'], ['Blue Violet', '#8A2BE2'], ['Indigo', '#4B0082'], ['Dark Orchid', '#9932CC'], ['Dark Violet', '#9400D3'], ['Medium Orchid', '#BA55D3'],
  ['Purple', '#800080'], ['Dark Magenta', '#8B008B'], ['Thistle', '#D8BFD8'], ['Plum', '#DDA0DD'], ['Violet', '#EE82EE'], ['Orchid', '#DA70D6'],
  ['Magenta', '#FF00FF'], ['Medium Violet Red', '#C71585'], ['Deep Pink', '#FF1493'], ['Hot Pink', '#FF69B4'], ['Pale Violet Red', '#DB7093'], ['Pink', '#FFC0CB'],
  ['Light Pink', '#FFB6C1'], ['Lavender', '#E6E6FA'], ['Lavender Blush', '#FFF0F5'], ['Misty Rose', '#FFE4E1'], ['Slate Gray', '#708090'], ['Light Slate Gray', '#778899'],
  ['Dark Slate Gray', '#2F4F4F'], ['Alice Blue', '#F0F8FF'], ['Azure', '#F0FFFF'], ['Honeydew', '#F0FFF0'], ['Mint Cream', '#F5FFFA'], ['Ghost White', '#F8F8FF'],
].map(([name, hex]) => ({ name, hex }));

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Perceptual-ish distance ("redmean"), good enough to pick a name. */
function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export function colorList(lang: string): NamedColor[] {
  return lang === 'en' ? EN_COLORS : ZH_COLORS;
}

export function nearestColorName(hex: string, lang: string): string {
  let best = '', bestD = Infinity;
  for (const c of colorList(lang)) {
    const d = distance(hex, c.hex);
    if (d < bestD) { bestD = d; best = c.name; }
  }
  return best;
}

export function randomNamedColor(lang: string): NamedColor {
  const list = colorList(lang);
  return list[Math.floor(Math.random() * list.length)];
}

/** Readable ink on a background colour. */
export function inkOn(hex: string): string {
  const [r, g, b] = rgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.92)';
}
