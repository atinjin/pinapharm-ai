// 영양제 일괄 등록용 CSV 파서. 따옴표/쉼표/개행을 처리한다.
// 헤더 컬럼: name, brand, price, stock, ingredients, conditionTags, description
// conditionTags 셀 안에서는 세미콜론(;)으로 여러 태그를 구분한다.

export type CsvProductRow = {
  name: string;
  brand?: string;
  price: number;
  stock?: number;
  ingredients?: string;
  conditionTags: string[];
  description?: string;
};

export type CsvParseResult = {
  rows: CsvProductRow[];
  errors: { line: number; message: string }[];
};

/** RFC4180 풍의 최소 CSV 토크나이저: 따옴표 안의 쉼표/개행/이스케이프("") 지원 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // 마지막 필드/행
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADERS = ["name", "brand", "price", "stock", "ingredients", "conditiontags", "description"];

/** 헤더가 있는 CSV 텍스트를 상품 행으로 변환한다. */
export function parseProductCsv(text: string): CsvParseResult {
  const table = parseCsv(text.trim());
  const result: CsvParseResult = { rows: [], errors: [] };
  if (table.length === 0) {
    result.errors.push({ line: 0, message: "빈 파일입니다." });
    return result;
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  if (idx("name") === -1 || idx("price") === -1) {
    result.errors.push({ line: 1, message: "헤더에 최소 name, price 컬럼이 필요합니다." });
    return result;
  }

  for (let r = 1; r < table.length; r++) {
    const cols = table[r];
    if (cols.every((c) => c.trim() === "")) continue; // 빈 줄 skip
    const get = (k: string) => {
      const i = idx(k);
      return i === -1 ? "" : (cols[i] ?? "").trim();
    };

    const name = get("name");
    const priceRaw = get("price");
    const price = Number(priceRaw.replace(/[,\s원]/g, ""));
    if (!name) {
      result.errors.push({ line: r + 1, message: "name(제품명)이 비어 있습니다." });
      continue;
    }
    if (!Number.isFinite(price) || price < 0) {
      result.errors.push({ line: r + 1, message: `price가 올바르지 않습니다: "${priceRaw}"` });
      continue;
    }

    const stockRaw = get("stock");
    const stock = stockRaw ? Number(stockRaw.replace(/[,\s]/g, "")) : 0;
    const tagsRaw = get("conditiontags");
    const conditionTags = tagsRaw
      ? tagsRaw
          .split(/[;|]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    result.rows.push({
      name,
      brand: get("brand") || undefined,
      price,
      stock: Number.isFinite(stock) ? stock : 0,
      ingredients: get("ingredients") || undefined,
      conditionTags,
      description: get("description") || undefined,
    });
  }
  return result;
}

export const SAMPLE_CSV = `name,brand,price,stock,ingredients,conditionTags,description
"종근당 락토핏 골드",종근당,12900,80,"유산균 19종",장건강;소화,"장 건강을 위한 프로바이오틱스"
"고려은단 비타민C 1000",고려은단,18000,50,"비타민C 1000mg",피로;면역,"피로 회복과 면역에 도움"
"뉴트리디데이 루테인",뉴트리디데이,21000,40,"루테인 20mg",눈건강,"눈 건강과 황반 보호"`;
