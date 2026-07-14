"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { COUNTRIES, TOURNAMENT_COUNTRIES, TOURNAMENT_LOCATIONS } from "./data-options";

type Row = Record<string, string>;
type TableName = "Players" | "Staff" | "Teams" | "Sponsors" | "Tournaments" | "Rosters";
type Locale = "zh" | "en";
type LocalizedMessage = Record<Locale, string>;
type TableData = { headers: string[]; rows: Row[] };
type Tables = Record<TableName, TableData>;
type Issue = { row: number; field: string; message: string };
type HistoryAction =
  | { kind: "cell"; table: TableName; row: number; field: string; before: string; after: string }
  | { kind: "add"; table: TableName; row: number; value: Row }
  | { kind: "delete"; table: TableName; row: number; value: Row };

type FieldRule = {
  type?: "number" | "url" | "date" | "boolean" | "color";
  min?: number;
  max?: number;
  options?: string[];
  ref?: TableName;
  refField?: string;
};

type TableDefinition = {
  label: string;
  singular: string;
  labelEn: string;
  singularEn: string;
  fileName: string;
  expectedRows: number;
  icon: string;
  primaryKey: string;
  uniquePrimary?: boolean;
  previewColumns: string[];
  rules: Record<string, FieldRule>;
};

const PLAYER_STATS = [
  "Skill", "AWP", "Rifle", "Pistol", "Reaction", "Tactic", "Leader", "Creativity",
  "Teamwork", "Conflict", "Morale", "Loyalty", "Grenades", "Clutch", "Productivity",
  "Stress Resistance", "Perception", "Health", "Strength", "Endurance",
];
const STAFF_STATS = [
  "Skill", "Awp", "Rifle", "Pistol", "Grenades", "Creativity", "Clutch", "Tactic",
  "Physiotherapy", "Fitness", "Playerability", "Evaluation", "Scouting", "Psychology",
  "Analysis", "Insight", "Publicrelations", "Financemanagement", "Legalknowledge",
  "Contractwork", "Eventorganization", "Leadership", "Vision", "Delegation", "PublicImage",
  "Communication", "FinancialLiteracy", "Morale", "Conflict", "Productivity", "Loyalty",
  "StressResistance", "Immunity",
];
const PLAYER_ROLES = ["Rifler", "AWPer", "Sniper", "Lurker", "Support", "Entry fragger", "In-game leader"];
const STAFF_ROLES = ["Coach", "Analyst", "CEO", "PR Manager", "Event Manager", "Scout", "Physiotherapist", "Psychologist"];
const MAPS = ["dust", "mirage", "nuke", "ancient", "inferno", "overpass", "train"];
const translate = (locale: Locale, zh: string, en: string) => locale === "en" ? en : zh;

const numericRules = (names: string[], min = 1, max = 20) =>
  Object.fromEntries(names.map((name) => [name, { type: "number", min, max } satisfies FieldRule]));

const DEFINITIONS: Record<TableName, TableDefinition> = {
  Players: {
    label: "选手", singular: "选手", labelEn: "Players", singularEn: "player", fileName: "Players.csv", expectedRows: 6192, icon: "P",
    primaryKey: "Id", previewColumns: ["Nick", "Name", "Surname", "Country", "Team", "Skill", "Role1", "Earnings"],
    rules: {
      ...numericRules(PLAYER_STATS), Leader: { type: "number", min: 0, max: 20 }, PR: { type: "number", min: 0, max: 100 }, Earnings: { type: "number", min: 0 },
      Birthdate: { type: "date" }, Team: { ref: "Teams", refField: "Nick" },
      Country: { options: [...COUNTRIES] },
      Role1: { options: PLAYER_ROLES }, Role2: { options: PLAYER_ROLES }, Role3: { options: PLAYER_ROLES },
      HLTV: { type: "url" }, Liquipedia: { type: "url" }, PhotoUrl: { type: "url" },
      Retired: { type: "boolean" }, FromFaceIt: { type: "boolean" }, Gender: { options: ["MALE", "FEMALE"] },
    },
  },
  Staff: {
    label: "职员", singular: "职员", labelEn: "Staff", singularEn: "staff member", fileName: "Staff.csv", expectedRows: 172, icon: "S",
    primaryKey: "Id", previewColumns: ["Nick", "Name", "Surname", "Role", "Country", "Team", "Skill", "Generated"],
    rules: {
      ...numericRules(STAFF_STATS), Role: { options: STAFF_ROLES }, Team: { ref: "Teams", refField: "Nick" },
      Country: { options: [...COUNTRIES] },
      Generated: { type: "boolean" }, Gender: { options: ["MALE", "FEMALE"] },
      HLTV: { type: "url" }, Liquipedia: { type: "url" }, PhotoUrl: { type: "url" },
    },
  },
  Teams: {
    label: "战队", singular: "战队", labelEn: "Teams", singularEn: "team", fileName: "Teams.csv", expectedRows: 327, icon: "T",
    primaryKey: "Nick", previewColumns: ["Nick", "Name", "Country", "Rating", "ERS", "StartIGL", "FPmap", "Disbanded"],
    rules: {
      Earnings: { type: "number", min: 0 }, Rating: { type: "number", min: 0, max: 20 }, ERS: { type: "number", min: 0 },
      Academy: { ref: "Teams", refField: "Nick" }, StartIGL: { ref: "Players", refField: "Nick" },
      Country: { options: [...COUNTRIES] },
      BgColor: { type: "color" }, FPmap: { options: MAPS }, FBmap: { options: MAPS },
      PhotoUrl: { type: "url" }, HLTV: { type: "url" }, Disbanded: { type: "boolean" },
    },
  },
  Sponsors: {
    label: "赞助商", singular: "赞助商", labelEn: "Sponsors", singularEn: "sponsor", fileName: "Sponsors.csv", expectedRows: 400, icon: "$",
    primaryKey: "Num", previewColumns: ["Num", "CompanyName", "Tier", "Type", "Description", "CreatedBy", "CreatedAt"],
    rules: {
      Num: { type: "number", min: 1 }, Tier: { options: ["S", "A", "B", "C", "D"] },
      Type: { options: ["Hardware", "Peripherals", "Infrastructure", "Apparel", "Consumables", "Lifestyle", "Finance", "Betting", "Culture", "Onboarding", "Automotive", "Hygiene", "Logistics", "Media", "Travel"] },
    },
  },
  Tournaments: {
    label: "赛事", singular: "赛事", labelEn: "Tournaments", singularEn: "tournament", fileName: "Tournaments.csv", expectedRows: 31, icon: "C",
    primaryKey: "id", previewColumns: ["id", "Name", "Tier", "Rating", "Prizefund", "Type", "CupId", "Country", "City"],
    rules: {
      Tier: { options: ["1", "2", "MAJOR"] }, Rating: { type: "number", min: 0, max: 5 },
      Prizefund: { type: "number", min: 0 }, Type: { options: ["LAN", "ONLINE"] },
      Country: { options: TOURNAMENT_COUNTRIES }, City: { options: TOURNAMENT_LOCATIONS.map(({ city }) => city) },
    },
  },
  Rosters: {
    label: "阵容顺序", singular: "阵容项", labelEn: "Roster order", singularEn: "roster entry", fileName: "roster_order.json", expectedRows: 106, icon: "R",
    primaryKey: "PlayerNick", uniquePrimary: false, previewColumns: ["Team", "Order", "PlayerNick"],
    rules: {
      Team: { ref: "Teams", refField: "Nick" }, Order: { type: "number", min: 1 },
      PlayerNick: { ref: "Players", refField: "Nick" },
    },
  },
};

const TABLE_ORDER = Object.keys(DEFINITIONS) as TableName[];
const EMPTY_TABLES = Object.fromEntries(TABLE_ORDER.map((name) => [name, { headers: [], rows: [] }])) as unknown as Tables;
const FIELD_LABELS: Record<string, string> = {
  Id: "Internal ID", id: "赛事 ID", Num: "赞助商编号", CupId: "赛事杯标识",
  City: "地区 / 城市",
  Nick: "昵称 / 短名", Name: "名字", Surname: "姓氏", Birthdate: "出生日期", Country: "国家/地区",
  Team: "所属战队", Skill: "综合能力", Role: "职务", Role1: "主要定位", Role2: "次要定位", Role3: "第三定位",
  Earnings: "生涯奖金", Description: "简介", Bio: "人物介绍", Rating: "评级", Prizefund: "奖金池",
  CompanyName: "公司名称", Type: "类型", Tier: "级别", PlayerNick: "选手昵称", Order: "顺序",
};
const FIELD_LABELS_EN: Record<string, string> = {
  Id: "Internal ID", id: "Tournament ID", Num: "Sponsor number", CupId: "Cup ID", City: "Region / City",
  Nick: "Nickname / Short name", Name: "First name / Name", Surname: "Surname", Birthdate: "Birth date", Country: "Country / Region",
  Team: "Team", Skill: "Overall skill", Role: "Role", Role1: "Primary position", Role2: "Secondary position", Role3: "Third position",
  Earnings: "Career earnings", Description: "Description", Bio: "Biography", Rating: "Rating", Prizefund: "Prize pool",
  CompanyName: "Company name", Type: "Type", Tier: "Tier", PlayerNick: "Player nickname", Order: "Order",
};

function parseDelimited(text: string, delimiter = ";"): TableData {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() ?? [];
  return {
    headers,
    rows: rows.filter((values) => values.some(Boolean)).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    ),
  };
}

function escapeCell(value: string) {
  const normalized = String(value ?? "");
  return /[;"\r\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

function serializeDelimited(table: TableData) {
  const lines = [table.headers.map(escapeCell).join(";")];
  table.rows.forEach((row) => lines.push(table.headers.map((header) => escapeCell(row[header])).join(";")));
  return `${lines.join("\n")}\n`;
}

function parseRosters(text: string): TableData {
  const object = JSON.parse(text) as Record<string, string[]>;
  const rows = Object.entries(object).flatMap(([team, players]) =>
    players.map((player, index) => ({ Team: team, Order: String(index + 1), PlayerNick: player })),
  );
  return { headers: ["Team", "Order", "PlayerNick"], rows };
}

function serializeRosters(table: TableData) {
  const grouped: Record<string, Row[]> = {};
  table.rows.forEach((row) => { (grouped[row.Team] ??= []).push(row); });
  return JSON.stringify(Object.fromEntries(Object.entries(grouped).map(([team, rows]) => [
    team,
    rows.sort((a, b) => Number(a.Order) - Number(b.Order)).map((row) => row.PlayerNick),
  ])));
}

function createBlankRow(headers: string[], definition: TableDefinition): Row {
  const row = Object.fromEntries(headers.map((header) => [header, ""]));
  const seed = `new-${Date.now().toString(36)}`;
  row[definition.primaryKey] = definition.primaryKey === "Num" ? "" : seed;
  if ("Id" in row) row.Id = seed;
  if ("Nick" in row && !row.Nick) row.Nick = seed;
  if ("Gender" in row) row.Gender = "MALE";
  if ("Generated" in row) row.Generated = "0";
  return row;
}

function safeAssetFileName(value: string, locale: Locale) {
  return value.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "").trim() || (locale === "zh" ? "请先填写命名字段" : "complete-the-naming-field");
}

function getAssetTip(tableName: TableName, row: Row, locale: Locale) {
  const root = "%USERPROFILE%\\AppData\\LocalLow\\NeuronaGames\\EsportsManager\\CustomAssets";
  if (tableName === "Players") return {
    path: `${root}\\Players`, fileName: `${safeAssetFileName(row.Id || row.Nick, locale)}.png`, size: "400×417 px",
    copy: locale === "zh" ? "将图片放入下方目录，并以 Internal ID 字段命名文件（默认等于昵称）。如果两名球员昵称相同，请将 Internal ID 设为 昵称_姓氏（例如 s1mple_Kostyliev）并以此命名文件。" : "Place the image in the directory below and name it with Internal ID (the nickname by default). For duplicate nicknames, use nickname_surname, for example s1mple_Kostyliev.",
  };
  if (tableName === "Teams") return {
    path: `${root}\\Teams`, fileName: `${safeAssetFileName(row.Name, locale)}.png`, size: "512×512 px",
    copy: locale === "zh" ? "将徽标放入下方目录，并以战队全名命名文件（例如 Natus Vincere.png、Vitality Esports.png）。" : "Place the logo in the directory below and use the full team name, for example Natus Vincere.png or Vitality Esports.png.",
  };
  if (tableName === "Staff") return {
    path: `${root}\\Staffs`, fileName: `${safeAssetFileName(row.Id || row.Nick, locale)}.png`, size: "512×512 px",
    copy: locale === "zh" ? "将图片放入下方目录，并以 Internal ID 字段命名文件（默认等于昵称）。如果两名员工昵称相同，请将 Internal ID 设为 昵称_姓氏 并以此命名文件。" : "Place the image in the directory below and name it with Internal ID (the nickname by default). For duplicate nicknames, use nickname_surname.",
  };
  if (tableName === "Sponsors") return {
    path: `${root}\\Sponsors`, fileName: `${safeAssetFileName(row.Num, locale)}.png`, size: "1024×1024 px",
    copy: locale === "zh" ? "将图片放入下方目录，并以赞助商编号命名文件。" : "Place the image in the directory below and name it with the sponsor number.",
  };
  if (tableName === "Tournaments") return {
    path: `${root}\\Tournaments`, fileName: `${safeAssetFileName(row.Name, locale)}.png`, size: "512×512 px",
    copy: locale === "zh" ? "将锦标赛图片放入下方目录，并以锦标赛全名命名文件。" : "Place the tournament image in the directory below and use the full tournament name.",
  };
  return null;
}

function isLikelyImageUrl(field: string, value: string) {
  return /^https?:\/\//i.test(value) && (/(photo|image|logo|avatar|icon|picture)/i.test(field) || /\.(?:png|jpe?g|webp|gif|avif|bmp)(?:[?#].*)?$/i.test(value));
}

function NetworkImagePreview({ url, locale }: { url: string; locale: Locale }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  return (
    <div className={`network-image-preview ${status}`}>
      <div className="network-image-stage">
        {/* User-provided remote URLs cannot use a fixed Next Image host allowlist. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={locale === "zh" ? "网络图片缩略图" : "Remote image thumbnail"} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />
        {status === "loading" && <span>{locale === "zh" ? "正在加载网络图片…" : "Loading remote image…"}</span>}
        {status === "error" && <span>{locale === "zh" ? "图片加载失败，请检查地址或防盗链限制" : "Image failed to load. Check the URL or hotlink restrictions."}</span>}
      </div>
      <a href={url} target="_blank" rel="noreferrer">{locale === "zh" ? "打开原图 ↗" : "Open original ↗"}</a>
    </div>
  );
}

function downloadText(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBytes(fileName: string, content: Uint8Array, type: string) {
  const blob = new Blob([content as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [tables, setTables] = useState<Tables>(EMPTY_TABLES);
  const [activeTable, setActiveTable] = useState<TableName>("Players");
  const [loaded, setLoaded] = useState(false);
  const [archiveName, setArchiveName] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [dirty, setDirty] = useState<Set<TableName>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loadingZip, setLoadingZip] = useState(false);
  const [message, setMessageState] = useState<LocalizedMessage>({ zh: "请上传解密后的数据库 ZIP", en: "Upload a decrypted database ZIP" });
  const [lastSaved, setLastSaved] = useState("");
  const [history, setHistory] = useState<HistoryAction[]>([]);
  const [future, setFuture] = useState<HistoryAction[]>([]);
  const [showStructure, setShowStructure] = useState(false);
  const archiveEntriesRef = useRef<Record<string, Uint8Array>>({});
  const archivePathsRef = useRef<Record<TableName, string>>({} as Record<TableName, string>);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const definition = DEFINITIONS[activeTable];
  const table = tables[activeTable];
  const english = locale === "en";
  const t = (zh: string, en: string) => english ? en : zh;
  const tableLabel = (name: TableName) => english ? DEFINITIONS[name].labelEn : DEFINITIONS[name].label;
  const fieldLabel = (field: string) => (english ? FIELD_LABELS_EN[field] : FIELD_LABELS[field]) || field;
  const setMessage = (zh: string, en: string) => setMessageState({ zh, en });
  const references = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    TABLE_ORDER.forEach((name) => {
      tables[name].headers.forEach((header) => {
        result[`${name}.${header}`] = new Set(tables[name].rows.map((row) => row[header]).filter(Boolean));
      });
    });
    return result;
  }, [tables]);

  const issues = useMemo(() => {
    if (!loaded) return [] as Issue[];
    const found: Issue[] = [];
    const primaryValues = new Map<string, number[]>();
    table.rows.forEach((row, rowIndex) => {
      const primary = row[definition.primaryKey];
      if (!primary) found.push({ row: rowIndex, field: definition.primaryKey, message: translate(locale, "主键不能为空", "Primary key cannot be empty") });
      else (primaryValues.get(primary) ?? primaryValues.set(primary, []).get(primary)!).push(rowIndex);
      Object.entries(definition.rules).forEach(([fieldName, rule]) => {
        const value = row[fieldName] ?? "";
        if (!value) return;
        if (rule.type === "number") {
          const number = Number(value);
          if (!Number.isFinite(number)) found.push({ row: rowIndex, field: fieldName, message: translate(locale, "应为数字", "Must be a number") });
          else if (rule.min !== undefined && number < rule.min) found.push({ row: rowIndex, field: fieldName, message: translate(locale, `低于样本常见值 ${rule.min}`, `Below the common sample value ${rule.min}`) });
          else if (rule.max !== undefined && number > rule.max) found.push({ row: rowIndex, field: fieldName, message: translate(locale, `高于样本常见值 ${rule.max}`, `Above the common sample value ${rule.max}`) });
        }
        if (rule.type === "url" && !/^https?:\/\//i.test(value)) found.push({ row: rowIndex, field: fieldName, message: translate(locale, "URL 格式无效", "Invalid URL format") });
        if (rule.type === "date" && !/^\d{2}\.\d{2}\.\d{4}$/.test(value)) found.push({ row: rowIndex, field: fieldName, message: translate(locale, "日期应为 DD.MM.YYYY", "Date must use DD.MM.YYYY") });
        if (rule.ref && rule.refField && !references[`${rule.ref}.${rule.refField}`]?.has(value)) {
          found.push({ row: rowIndex, field: fieldName, message: translate(locale, `未在 ${DEFINITIONS[rule.ref].label} 中找到`, `Not found in ${DEFINITIONS[rule.ref].labelEn}`) });
        }
      });
      if (activeTable === "Tournaments" && row.City) {
        if (!row.Country) found.push({ row: rowIndex, field: "City", message: translate(locale, "请先选择国家，再选择地区", "Select a country before choosing a region") });
        else if (!TOURNAMENT_LOCATIONS.some(({ city, country }) => city === row.City && country === row.Country)) {
          found.push({ row: rowIndex, field: "City", message: translate(locale, "地区与所选国家不匹配", "The region does not match the selected country") });
        }
      }
    });
    if (definition.uniquePrimary !== false) {
      primaryValues.forEach((rows, value) => {
        if (rows.length > 1) rows.forEach((row) => found.push({ row, field: definition.primaryKey, message: translate(locale, `主键 ${value} 重复`, `Duplicate primary key: ${value}`) }));
      });
    }
    return found;
  }, [activeTable, definition, loaded, locale, references, table.rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const rows = table.rows.map((row, index) => ({ row, index }));
    if (!query) return rows;
    return rows.filter(({ row }) => definition.previewColumns.some((column) => row[column]?.toLocaleLowerCase().includes(query)));
  }, [definition.previewColumns, search, table.rows]);

  const pageSize = 40;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const selected = selectedRow === null ? null : table.rows[selectedRow];
  const selectedIssues = selectedRow === null ? [] : issues.filter((issue) => issue.row === selectedRow);
  const assetTip = selected ? getAssetTip(activeTable, selected, locale) : null;

  async function loadZipFile(file: File) {
    if (!file.name.toLocaleLowerCase().endsWith(".zip")) {
      setMessage("请选择 .zip 格式的解密数据库", "Select a decrypted database in .zip format");
      return;
    }
    setLoadingZip(true);
    setMessage(`正在解析 ${file.name}…`, `Parsing ${file.name}…`);
    try {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const files = Object.entries(entries)
        .filter(([entryPath]) => !entryPath.endsWith("/") && !entryPath.replaceAll("\\", "/").startsWith("__MACOSX/"))
        .sort(([left], [right]) => left.split(/[\\/]/).length - right.split(/[\\/]/).length);
      const next = { ...EMPTY_TABLES } as Tables;
      const paths = {} as Record<TableName, string>;
      for (const name of TABLE_ORDER) {
        const expected = DEFINITIONS[name].fileName.toLocaleLowerCase();
        const match = files.find(([entryPath]) => entryPath.split(/[\\/]/).at(-1)?.toLocaleLowerCase() === expected);
        if (!match) throw new Error(t(`ZIP 中缺少 ${DEFINITIONS[name].fileName}`, `ZIP is missing ${DEFINITIONS[name].fileName}`));
        const [entryPath, bytes] = match;
        const text = strFromU8(bytes);
        paths[name] = entryPath;
        next[name] = name === "Rosters" ? parseRosters(text) : parseDelimited(text);
      }
      archiveEntriesRef.current = entries;
      archivePathsRef.current = paths;
      setTables(next);
      setLoaded(true);
      setDirty(new Set());
      setHistory([]);
      setFuture([]);
      setSelectedRow(null);
      setPage(1);
      setArchiveName(file.name);
      setMessage("ZIP 已在浏览器内解析；所有字段均可自由编辑", "ZIP parsed in the browser; every field is editable");
    } catch (error) {
      setMessage(`ZIP 解析失败：${(error as Error).message}`, `ZIP parsing failed: ${(error as Error).message}`);
    } finally {
      setLoadingZip(false);
    }
  }

  function chooseZip() {
    inputRef.current?.click();
  }

  async function loadZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await loadZipFile(file);
  }

  async function dropZip(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) await loadZipFile(file);
  }

  function markDirty(name: TableName) {
    setDirty((current) => new Set(current).add(name));
  }

  function selectTable(name: TableName) {
    setActiveTable(name);
    setSelectedRow(null);
    setSearch("");
    setPage(1);
  }

  function applyAction(action: HistoryAction, reverse = false) {
    setTables((current) => {
      const next = { ...current, [action.table]: { ...current[action.table], rows: [...current[action.table].rows] } };
      const rows = next[action.table].rows;
      if (action.kind === "cell") rows[action.row] = { ...rows[action.row], [action.field]: reverse ? action.before : action.after };
      if (action.kind === "add") {
        if (reverse) rows.splice(action.row, 1);
        else rows.splice(action.row, 0, action.value);
      }
      if (action.kind === "delete") {
        if (reverse) rows.splice(action.row, 0, action.value);
        else rows.splice(action.row, 1);
      }
      return next;
    });
    markDirty(action.table);
  }

  function updateCell(field: string, value: string) {
    if (selectedRow === null) return;
    const before = tables[activeTable].rows[selectedRow][field] ?? "";
    if (before === value) return;
    const action: HistoryAction = { kind: "cell", table: activeTable, row: selectedRow, field, before, after: value };
    applyAction(action);
    setHistory((current) => [...current.slice(-99), action]);
    setFuture([]);
  }

  function updateField(field: string, value: string) {
    updateCell(field, value);
    if (activeTable === "Tournaments" && field === "Country" && selected?.City) {
      const cityStillMatches = TOURNAMENT_LOCATIONS.some(({ city, country }) => city === selected.City && country === value);
      if (!cityStillMatches) updateCell("City", "");
    }
  }

  function addRow() {
    if (!loaded) return;
    const value = createBlankRow(table.headers, definition);
    const action: HistoryAction = { kind: "add", table: activeTable, row: table.rows.length, value };
    applyAction(action);
    setHistory((current) => [...current.slice(-99), action]);
    setFuture([]);
    setSelectedRow(table.rows.length);
    setPage(Math.ceil((table.rows.length + 1) / pageSize));
  }

  function uniqueCopyValue(field: string, source: string) {
    const existing = new Set(table.rows.map((row) => row[field]).filter(Boolean));
    const stem = `${source || "record"}_copy`;
    let candidate = stem;
    let suffix = 2;
    while (existing.has(candidate)) candidate = `${stem}_${suffix++}`;
    return candidate;
  }

  function cloneRow() {
    if (selectedRow === null || !selected) return;
    const value = { ...selected };
    if (activeTable === "Players" || activeTable === "Staff") {
      value.Nick = uniqueCopyValue("Nick", selected.Nick || selected.Id);
      value.Id = uniqueCopyValue("Id", selected.Id || selected.Nick);
    } else if (activeTable === "Teams") {
      value.Nick = uniqueCopyValue("Nick", selected.Nick || selected.Name);
      if (value.Name) value.Name = `${value.Name} Copy`;
    } else if (activeTable === "Tournaments") {
      const oldId = value.id;
      value.id = uniqueCopyValue("id", oldId || selected.Name);
      if (value.CupId === oldId) value.CupId = value.id;
      if (value.Name) value.Name = `${value.Name} Copy`;
    } else if (activeTable === "Sponsors") {
      const nextNumber = Math.max(0, ...table.rows.map((row) => Number(row.Num)).filter(Number.isFinite)) + 1;
      value.Num = String(nextNumber);
      if (value.CompanyName) value.CompanyName = `${value.CompanyName} Copy`;
    } else if (activeTable === "Rosters") {
      const teamOrders = table.rows.filter((row) => row.Team === value.Team).map((row) => Number(row.Order)).filter(Number.isFinite);
      value.Order = String(Math.max(0, ...teamOrders) + 1);
    }
    const newIndex = table.rows.length;
    const action: HistoryAction = { kind: "add", table: activeTable, row: newIndex, value };
    applyAction(action);
    setHistory((current) => [...current.slice(-99), action]);
    setFuture([]);
    setSelectedRow(newIndex);
    setPage(Math.ceil((newIndex + 1) / pageSize));
    setMessage(`已复制为新的${definition.singular}记录，请检查标识字段后导出 ZIP`, `Copied as a new ${definition.singularEn}. Check its identifier before exporting the ZIP.`);
  }

  function deleteRow() {
    if (selectedRow === null || !selected) return;
    const action: HistoryAction = { kind: "delete", table: activeTable, row: selectedRow, value: selected };
    applyAction(action);
    setHistory((current) => [...current.slice(-99), action]);
    setFuture([]);
    setSelectedRow(null);
  }

  function undo() {
    const action = history.at(-1);
    if (!action) return;
    applyAction(action, true);
    setHistory((current) => current.slice(0, -1));
    setFuture((current) => [...current, action]);
  }

  function redo() {
    const action = future.at(-1);
    if (!action) return;
    applyAction(action);
    setFuture((current) => current.slice(0, -1));
    setHistory((current) => [...current, action]);
  }

  function getSerialized(name: TableName) {
    return name === "Rosters" ? serializeRosters(tables[name]) : serializeDelimited(tables[name]);
  }

  function exportTable(name = activeTable) {
    const def = DEFINITIONS[name];
    downloadText(def.fileName, getSerialized(name), name === "Rosters" ? "application/json" : "text/csv;charset=utf-8");
    setMessage(`${def.fileName} 已导出`, `${def.fileName} exported`);
  }

  async function exportZip() {
    if (!loaded) return;
    setSaving(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const entries = { ...archiveEntriesRef.current };
      for (const name of dirty) {
        entries[archivePathsRef.current[name]] = strToU8(getSerialized(name));
      }
      const output = zipSync(entries, { level: 6 });
      const baseName = archiveName.replace(/\.zip$/i, "");
      downloadBytes(`${baseName}_edited.zip`, output, "application/zip");
      archiveEntriesRef.current = entries;
      setDirty(new Set());
      const time = new Date().toLocaleTimeString(english ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" });
      setLastSaved(time);
      setMessage(`已导出 ${baseName}_edited.zip · ${time}`, `Exported ${baseName}_edited.zip · ${time}`);
    } catch (error) { setMessage(`ZIP 导出失败：${(error as Error).message}`, `ZIP export failed: ${(error as Error).message}`); }
    finally { setSaving(false); }
  }

  function renderEditor(field: string, value: string) {
    const rule = definition.rules[field] ?? {};
    const fieldIssues = selectedIssues.filter((issue) => issue.field === field);
    const longText = ["Bio", "Description"].includes(field);
    const refValues = rule.ref && rule.refField ? Array.from(references[`${rule.ref}.${rule.refField}`] ?? []).sort() : [];
    let contextualOptions = rule.options ?? [];
    if (activeTable === "Tournaments" && field === "Country") contextualOptions = TOURNAMENT_COUNTRIES;
    const tournamentCity = activeTable === "Tournaments" && field === "City";
    if (tournamentCity) {
      contextualOptions = selected?.Country
        ? TOURNAMENT_LOCATIONS.filter(({ country }) => country === selected.Country).map(({ city }) => city)
        : [];
    }
    const currentValueMatches = !tournamentCity || !value || TOURNAMENT_LOCATIONS.some(({ city, country }) => city === value && country === selected?.Country);
    const suggestions = Array.from(new Set([...contextualOptions, ...refValues, ...(value && currentValueMatches ? [value] : [])])).sort((a, b) => a.localeCompare(b));
    const inputId = `field-${field.replaceAll(" ", "-")}`;
    if (rule.type === "boolean") {
      return (
        <label className="switch-row" htmlFor={inputId}>
          <input id={inputId} type="checkbox" checked={value === "1"} onChange={(event) => updateField(field, event.target.checked ? "1" : (["Retired", "Disbanded"].includes(field) ? "" : "0"))} />
          <span className="switch" /> <span>{value === "1" ? t("启用 / 1", "Enabled / 1") : t("关闭 / 0", "Disabled / 0")}</span>
        </label>
      );
    }
    if (longText) return <textarea id={inputId} value={value} rows={5} onChange={(event) => updateField(field, event.target.value)} />;
    return (
      <>
        <div className={`input-wrap ${suggestions.length || tournamentCity ? "searchable-combobox" : ""}`}>
          {rule.type === "color" && <input className="color-input" type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#1d7468"} onChange={(event) => updateCell(field, event.target.value)} aria-label={t("选择颜色", "Choose color")} />}
          <input
            id={inputId}
            type={rule.type === "number" ? "number" : rule.type === "url" ? "url" : "text"}
            min={rule.min} max={rule.max} value={value}
            list={suggestions.length ? `list-${inputId}` : undefined}
            disabled={tournamentCity && !selected?.Country}
            placeholder={tournamentCity && !selected?.Country ? t("请先选择国家", "Select a country first") : suggestions.length ? t("输入关键字搜索或选择…", "Type to search or choose…") : undefined}
            aria-autocomplete={suggestions.length ? "list" : undefined}
            onChange={(event) => updateField(field, event.target.value)}
            onBlur={(event) => {
              if (tournamentCity && event.target.value && !TOURNAMENT_LOCATIONS.some(({ city, country }) => city === event.target.value && country === selected?.Country)) updateField(field, "");
            }}
            className={fieldIssues.length ? "invalid" : ""}
          />
          {(suggestions.length > 0 || tournamentCity) && <span className="combobox-marker" aria-hidden="true">⌄</span>}
          {suggestions.length > 0 && <datalist id={`list-${inputId}`}>{suggestions.map((option) => <option key={option} value={option} />)}</datalist>}
        </div>
        {isLikelyImageUrl(field, value) && <NetworkImagePreview key={value} url={value} locale={locale} />}
      </>
    );
  }

  return (
    <main className="app-shell" lang={english ? "en" : "zh-CN"}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">E</span><div><strong>EMDB <em>LOCAL EDITER</em></strong><small>Unrestricted local database workbench</small></div></div>
        <div className="topbar-center">
          <span className={`connection-dot ${loaded ? "online" : ""}`} />
          <div><strong>{loaded ? archiveName : t("未载入数据库", "No database loaded")}</strong><small>{message[locale]}</small></div>
        </div>
        <div className="top-actions">
          <button className="language-button" onClick={() => setLocale(english ? "zh" : "en")} aria-label={t("切换到英语", "Switch to Chinese")}>{english ? "中文" : "EN"}</button>
          <button className="icon-button" onClick={undo} disabled={!history.length} aria-label={t("撤销", "Undo")}>↶</button>
          <button className="icon-button" onClick={redo} disabled={!future.length} aria-label={t("重做", "Redo")}>↷</button>
          <button className="secondary-button" onClick={chooseZip} disabled={loadingZip}>{loadingZip ? t("解析中…", "Parsing…") : loaded ? t("更换 ZIP", "Replace ZIP") : t("上传 ZIP", "Upload ZIP")}</button>
          <button className="primary-button" onClick={exportZip} disabled={!loaded || saving}>{saving ? t("打包中…", "Packing…") : `${t("导出 ZIP", "Export ZIP")}${dirty.size ? ` · ${dirty.size}` : ""}`}</button>
          <input ref={inputRef} className="hidden-input" type="file" accept=".zip,application/zip" onChange={loadZip} />
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-label">DATABASE TABLES</div>
        <nav>
          {TABLE_ORDER.map((name) => {
            const def = DEFINITIONS[name];
            const count = loaded ? tables[name].rows.length : def.expectedRows;
            return (
              <button key={name} className={`nav-item ${activeTable === name ? "active" : ""}`} onClick={() => selectTable(name)}>
                <span className="nav-icon">{def.icon}</span><span>{tableLabel(name)}<small>{def.fileName}</small></span>
                <b>{count.toLocaleString()}</b>{dirty.has(name) && <i />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        <button className="schema-button" onClick={() => setShowStructure(true)}><span>⌘</span><span>{t("数据库结构", "Database structure")}<small>{t("6 个数据集合 · 7,228 行", "6 datasets · 7,228 rows")}</small></span></button>
        <div className="local-card"><span className="shield">✓</span><div><strong>{t("本地优先", "Local first")}</strong><p>{t("数据库只在浏览器中处理，不会上传。", "The database is processed only in your browser and is never uploaded.")}</p></div></div>
      </aside>

      <section className="workspace">
        <div className="workspace-header">
          <div className="title-row"><span className="section-kicker">{definition.fileName}</span>{dirty.has(activeTable) && <span className="dirty-badge">{t("待导出", "Unsaved export")}</span>}</div>
          <div className="heading-row">
            <div><h1>{tableLabel(activeTable)}</h1><p>{t(`管理${definition.singular}记录、字段提示和跨表关联；所有字段均可自由修改。`, `Manage ${definition.labelEn.toLocaleLowerCase()}, field hints, and cross-table relationships. Every field is editable.`)}</p></div>
            <div className="header-actions"><button className="ghost-button" onClick={() => exportTable()} disabled={!loaded}>{t("导出当前表", "Export table")}</button><button className="dark-button" onClick={addRow} disabled={!loaded}>＋ {t(`新建${definition.singular}`, `New ${definition.singularEn}`)}</button></div>
          </div>
          <div className="stat-strip">
            <div><span>{t("记录", "Records")}</span><strong>{(loaded ? table.rows.length : definition.expectedRows).toLocaleString()}</strong></div>
            <div><span>{t("字段", "Fields")}</span><strong>{loaded ? table.headers.length : definition.previewColumns.length}</strong></div>
            <div><span>{t("当前视图", "Current view")}</span><strong>{loaded ? filteredRows.length.toLocaleString() : "—"}</strong></div>
            <div><span>{t("校验问题", "Validation issues")}</span><strong className={issues.length ? "warning-text" : "good-text"}>{loaded ? issues.length : "—"}</strong></div>
            <div className="save-meta"><span>{t("最近导出", "Last export")}</span><strong>{lastSaved || t("尚未导出", "Not exported")}</strong></div>
          </div>
        </div>

        {!loaded ? (
          <div className="welcome-panel" onDragOver={(event) => event.preventDefault()} onDrop={dropZip}>
            <div className="welcome-grid">
              <div className="welcome-copy zip-dropzone">
                <span className="eyebrow">LOCAL ZIP WORKSPACE</span>
                <h2>{t("上传解密 ZIP，开始自由编辑", "Upload a decrypted ZIP and start editing")}</h2>
                <p>{t("选择任意包含 EMDB 数据表的 ZIP。文件会直接在浏览器内解析，不上传、不登录，也没有官方网页的账号、角色、数量或编辑权限限制。", "Choose any ZIP containing the EMDB data tables. It is parsed directly in your browser with no upload, sign-in, account role, record cap, or official-site editing restriction.")}</p>
                <div className="welcome-actions"><button className="primary-button large" onClick={chooseZip} disabled={loadingZip}>{loadingZip ? t("正在解析…", "Parsing…") : t("上传 .zip 文件", "Upload .zip file")}</button><button className="text-button" onClick={() => setShowStructure(true)}>{t("查看结构分析 →", "View structure analysis →")}</button></div>
                <div className="drop-hint">{t("也可以把 ZIP 文件拖到这里", "You can also drop the ZIP file here")}</div>
                <div className="requirements"><span>{t("需要包含", "Required files")}</span>{TABLE_ORDER.map((name) => <code key={name}>{DEFINITIONS[name].fileName}</code>)}</div>
              </div>
              <div className="workflow-card">
                <div className="workflow-title"><span>{t("推荐工作流", "Recommended workflow")}</span><b>4 STEPS</b></div>
                {(english ? [
                  ["01", "Prepare ZIP", "Decrypt the database ZIP with EMDB Tool"],
                  ["02", "Upload and parse", "The ZIP is expanded only in browser memory"],
                  ["03", "Edit freely", "Add, edit, and delete without account or record limits"],
                  ["04", "Export ZIP", "Download the edited ZIP and encrypt it again"],
                ] : [
                  ["01", "准备 ZIP", "使用 EMDB Tool 解密得到数据库 ZIP"],
                  ["02", "上传并解析", "ZIP 只在浏览器内存中展开"],
                  ["03", "自由编辑", "新增、修改、删除均不设账号和数量限制"],
                  ["04", "导出 ZIP", "下载编辑版 ZIP，再用工具重新加密"],
                ]).map(([number, title, copy]) => <div className="workflow-step" key={number}><b>{number}</b><span><strong>{title}</strong><small>{copy}</small></span></div>)}
              </div>
            </div>
            <div className="schema-summary">
              {TABLE_ORDER.slice(0, 5).map((name) => <div key={name}><span>{tableLabel(name)}</span><strong>{DEFINITIONS[name].expectedRows.toLocaleString()}</strong><small>{t("条记录", "records")}</small></div>)}
            </div>
          </div>
        ) : (
          <div className="data-panel">
            <div className="toolbar">
              <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t(`搜索 ${definition.label}…`, `Search ${definition.labelEn.toLocaleLowerCase()}…`)} /></label>
              <div className="toolbar-note">{t(`显示 ${visibleRows.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, filteredRows.length)}，共 ${filteredRows.length.toLocaleString()} 条`, `Showing ${visibleRows.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, filteredRows.length)} of ${filteredRows.length.toLocaleString()}`)}</div>
              <button className="tool-button" onClick={() => setShowStructure(true)}>{t("字段提示", "Field hints")}</button>
            </div>
            <div className="table-container">
              <table>
                <thead><tr><th className="row-number">#</th>{definition.previewColumns.map((column) => <th key={column}>{fieldLabel(column)}<small>{column}</small></th>)}<th className="status-column">{t("状态", "Status")}</th></tr></thead>
                <tbody>
                  {visibleRows.map(({ row, index }, visibleIndex) => {
                    const rowIssueCount = issues.filter((issue) => issue.row === index).length;
                    return (
                      <tr key={`${index}-${row[definition.primaryKey]}`} className={selectedRow === index ? "selected" : ""} onClick={() => setSelectedRow(index)}>
                        <td className="row-number">{(page - 1) * pageSize + visibleIndex + 1}</td>
                        {definition.previewColumns.map((column) => <td key={column} title={row[column]}>{column === "BgColor" && row[column] ? <span className="color-chip" style={{ background: row[column] }} /> : null}<span>{row[column] || <em>{t("空", "Empty")}</em>}</span></td>)}
                        <td className="status-column">{rowIssueCount ? <span className="issue-pill">{rowIssueCount}</span> : <span className="ok-mark">✓</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visibleRows.length && <div className="empty-state">{t("没有符合条件的记录", "No matching records")}</div>}
            </div>
            <div className="pagination"><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>← {t("上一页", "Previous")}</button><span>{t("第", "Page")} <b>{page}</b> / {pageCount} {t("页", "")}</span><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>{t("下一页", "Next")} →</button></div>
          </div>
        )}
      </section>

      {selected && (
        <aside className="drawer">
          <div className="drawer-header"><div><span>EDIT RECORD</span><h2>{selected[definition.primaryKey] || t(`新${definition.singular}`, `New ${definition.singularEn}`)}</h2></div><button onClick={() => setSelectedRow(null)} aria-label={t("关闭编辑器", "Close editor")}>×</button></div>
          {selectedIssues.length > 0 && <div className="issue-summary"><strong>{selectedIssues.length} {t("个校验问题", "validation issues")}</strong><span>{selectedIssues[0].field}: {selectedIssues[0].message}</span></div>}
          <div className="drawer-fields">
            {table.headers.map((field) => (
              <div className="field" key={field}><label htmlFor={`field-${field.replaceAll(" ", "-")}`}><span>{fieldLabel(field)}</span>{(FIELD_LABELS[field] || FIELD_LABELS_EN[field]) && <small>{field}</small>}</label>{renderEditor(field, selected[field] ?? "")}{selectedIssues.filter((issue) => issue.field === field).map((issue) => <p className="field-error" key={issue.message}>{issue.message}</p>)}</div>
            ))}
            {assetTip && (
              <section className="game-usage-tip">
                <div className="game-tip-title"><span>🎮</span><strong>{t("在游戏中使用", "Use in game")}</strong></div>
                <p>{assetTip.copy}</p>
                <dl>
                  <div><dt>{t("资源目录", "Asset directory")}</dt><dd><code>{assetTip.path}</code>{activeTable === "Tournaments" && <span aria-label={t("赛事目录", "Tournament directory")}> 📋</span>}</dd></div>
                  <div><dt>{t("自动生成名称", "Generated file name")}</dt><dd><code className="generated-file-name">{assetTip.fileName}</code></dd></div>
                  <div><dt>{t("图片推荐尺寸", "Recommended image size")}</dt><dd><strong>{assetTip.size}</strong></dd></div>
                </dl>
              </section>
            )}
          </div>
          <div className="drawer-footer"><button className="danger-button" onClick={deleteRow}>{t("删除记录", "Delete")}</button><div className="drawer-footer-actions"><button className="ghost-button" onClick={cloneRow}>{t("复制为新记录", "Copy as new")}</button><button className="primary-button" onClick={() => setSelectedRow(null)}>{t("完成", "Done")}</button></div></div>
        </aside>
      )}

      {showStructure && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowStructure(false); }}>
          <section className="structure-modal" role="dialog" aria-modal="true" aria-label={t("数据库结构分析", "Database structure analysis")}>
            <div className="modal-header"><div><span>DATABASE MAP</span><h2>{t("EMDB ZIP 结构参考", "EMDB ZIP structure reference")}</h2><p>{t("基于官方解密数据库样本的实际字段与关联，仅作提示，不限制编辑或导出。", "Based on the actual fields and relationships in the official decrypted database sample. Hints do not restrict editing or export.")}</p></div><button onClick={() => setShowStructure(false)} aria-label={t("关闭", "Close")}>×</button></div>
            <div className="relation-map">
              <div className="entity main"><b>Players</b><span>{t("Id · 唯一主键", "Id · unique primary key")}</span><span>Team → Teams.Nick</span><small>{t("6,192 行 · 42 字段", "6,192 rows · 42 fields")}</small></div>
              <div className="connector">→</div>
              <div className="entity accent"><b>Teams</b><span>{t("Nick · 唯一主键", "Nick · unique primary key")}</span><span>StartIGL → Players.Nick</span><small>{t("327 行 · 17 字段", "327 rows · 17 fields")}</small></div>
              <div className="connector">←</div>
              <div className="entity"><b>Staff</b><span>{t("Id · 唯一主键", "Id · unique primary key")}</span><span>Team → Teams.Nick</span><small>{t("172 行 · 47 字段", "172 rows · 47 fields")}</small></div>
              <div className="entity"><b>Rosters</b><span>Team → Teams.Nick</span><span>PlayerNick → Players.Nick</span><small>{t("106 项 · 3 个未解析昵称", "106 entries · 3 unresolved nicknames")}</small></div>
              <div className="entity muted"><b>Sponsors</b><span>{t("Num · 唯一主键", "Num · unique primary key")}</span><span>{t("独立数据集", "Independent dataset")}</span><small>{t("400 行 · 7 字段", "400 rows · 7 fields")}</small></div>
              <div className="entity muted"><b>Tournaments</b><span>{t("id · 唯一主键", "id · unique primary key")}</span><span>{t("CupId · 赛事杯标识", "CupId · tournament cup identifier")}</span><small>{t("31 行 · 10 字段", "31 rows · 10 fields")}</small></div>
            </div>
            <div className="rule-grid"><div><strong>{t("能力值", "Ability values")}</strong><span>{t("Player / Staff 属性通常为 1–20", "Player / Staff attributes are usually 1–20")}</span></div><div><strong>{t("公共关系", "Public relations")}</strong><span>Players.PR · 0–100</span></div><div><strong>{t("赛事评分", "Tournament rating")}</strong><span>Tournaments.Rating · 0–5</span></div><div><strong>{t("日期格式", "Date format")}</strong><span>Birthdate · DD.MM.YYYY</span></div></div>
            <div className="analysis-note"><span>!</span><p><strong>{t("发现 20 个已有未解析引用", "20 existing unresolved references found")}</strong>{t("其中 Teams.StartIGL 有 16 项、Teams.Academy 有 1 项，阵容顺序有 3 项（AquaRs、huNter_kovac、lucky_1）。编辑器会标记，但不会擅自修改官方数据。", "There are 16 in Teams.StartIGL, 1 in Teams.Academy, and 3 in roster order (AquaRs, huNter_kovac, lucky_1). The editor flags them but never rewrites official data automatically.")}</p></div>
          </section>
        </div>
      )}
    </main>
  );
}
