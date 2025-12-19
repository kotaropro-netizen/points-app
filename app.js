/* v0.2：項目追加（入力/ストア）対応・継続タスク追加 */
const STORAGE_KEY = "kouchan_points_v021";

const $ = (sel) => document.querySelector(sel);
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1) + "pt";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const nowIso = () => new Date().toISOString();
const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const parseNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function roundToStep(n, step) {
  const x = Math.round(n * 10) / 10;
  if (!step || step <= 0) return x;
  const k = x / step;
  return Math.round(k) * step;
}

function rid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(2, 6)}`;
}

function defaultState() {
  return {
    version: 2.21,
    config: {
      yenPerPt: 10,
      roundStep: 10,
      goalPt: 6000,

      vendingBaseYen: 180,
      alcoholBaseYen: 1000,
      skinDiscount: 0.8,

      // 係数（初期）
      mosPerMin: 0.1,
      guitarPerMin: 0.1,
      napPerHour: -2,       // ← 確定：-2
      toothPt: 1,
      waterPt: 2,
      skinPt: 1,
      diaryPt: 5,
      taskAddPt: -5,
      taskDonePt: 5,
      forgotPt: -10,
      sameDayPt: 5,

      // 成績（初期）
      scorePosMul: 0.1,
      scoreNegMul: 0.5,     // ← 確定：0.5

      // 継続タスク
      deskPtPer: 1,
      floorPtPer: 1,
      trashOkPt: 2,
      cleanPenaltyPerUnit: 2,   // ← 確定：減った数×2
      trashDropPenalty: 3,      // ← 確定：1→0で-3
    },
    custom: {
      inputs: [],   // {id,name,type,max,coef,signSplit,posCoef,negCoef,prevPenaltyOn,prevPenaltyPer,prevDropPenalty}
      stores: [],   // {id,name,type,pt,baseYen,yen,discount,tag}
      editing: { ci: null, cs: null },
      builtinStoreOverrides: {} // { [id]: { hidden?:boolean, name?:string, pt?:number } }
    },
    balances: {
      balance: 0,
      debt: 0,
      lifetimeEarned: 0,
      lastSubmitIso: null
    },
    days: {
      // "YYYY-MM-DD": { draft: {...}, customDraft:{[id]:value}, logs:[...] }
    }
  };
}

function migrateState(st) {
  if (!st || typeof st !== "object") return defaultState();

  // v0.1 → v0.2 っぽい移行（最低限）
  if (!st.version) st.version = 1;
  if (!st.config) st.config = defaultState().config;

  const def = defaultState();

  // config keys fill
  st.config = { ...def.config, ...st.config };

  // custom fill
  if (!st.custom) st.custom = def.custom;
  if (!st.custom.inputs) st.custom.inputs = [];
  if (!st.custom.builtinStoreOverrides) st.custom.builtinStoreOverrides = {};
  
  if (!st.custom.stores) st.custom.stores = [];
  if (!st.custom.editing) st.custom.editing = { ci: null, cs: null };

  // balances fill
  if (!st.balances) st.balances = def.balances;
  st.balances = { ...def.balances, ...st.balances };

  // days fill
  if (!st.days) st.days = {};
  for (const k of Object.keys(st.days)) {
    const d = st.days[k];
    if (!d.draft) d.draft = defaultDraft();
    d.draft = normalizeDraft(d.draft);
    if (!d.customDraft) d.customDraft = {};
    if (!d.logs) d.logs = [];
  }

  st.version = 2.2;
  return st;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateState(defaultState());
    return migrateState(JSON.parse(raw));
  } catch {
    return migrateState(defaultState());
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- Draft / Day ---------- */
function defaultDraft() {
  return {
    // 習慣
    tooth: 0, skin: 0, water: 0, diary: 0,
    // 継続
    desk: 0, floor: 0, trashOk: 0,
    // 時間・数値
    mosMin: "", guitarMin: "", napHour: "", scoreDiff: "",
    // 課題
    forgotCount: 0, sameDayCount: 0,
    taskAdd: "", taskDone: ""
  };
}

function normalizeDraft(draft) {
  if (!draft || typeof draft !== "object") return defaultDraft();

  // v0.2 → v0.2.1: checkbox→件数
  if (typeof draft.forgot === "boolean" && typeof draft.forgotCount === "undefined") {
    draft.forgotCount = draft.forgot ? 1 : 0;
    delete draft.forgot;
  }
  if (typeof draft.sameDay === "boolean" && typeof draft.sameDayCount === "undefined") {
    draft.sameDayCount = draft.sameDay ? 1 : 0;
    delete draft.sameDay;
  }

  if (typeof draft.forgotCount !== "number") draft.forgotCount = parseNum(draft.forgotCount, 0);
  if (typeof draft.sameDayCount !== "number") draft.sameDayCount = parseNum(draft.sameDayCount, 0);

  // missing keys fill
  const def = defaultDraft();
  for (const k of Object.keys(def)) {
    if (typeof draft[k] === "undefined") draft[k] = def[k];
  }
  return draft;
}

function ensureDay(dateStr) {
  if (!state.days[dateStr]) {
    state.days[dateStr] = { draft: defaultDraft(), customDraft: {}, logs: [] };
  } else {
    if (!state.days[dateStr].draft) state.days[dateStr].draft = defaultDraft();
    state.days[dateStr].draft = normalizeDraft(state.days[dateStr].draft);
    if (!state.days[dateStr].customDraft) state.days[dateStr].customDraft = {};
    if (!state.days[dateStr].logs) state.days[dateStr].logs = [];
  }
  return state.days[dateStr];
}

function daySum(dateStr) {
  const d = state.days[dateStr];
  if (!d || !d.logs) return 0;
  return d.logs.reduce((a, x) => a + parseNum(x.delta, 0), 0);
}

/* ---------- Store Items ---------- */
function builtinStoreItems() {
  return [
    { id:"eat_out", name:"外食（解禁）", kind:"fixed", pt:250, tag:"食" },
    { id:"nomikai", name:"飲み会（解禁）", kind:"fixed", pt:400, tag:"食" },

    { id:"drink_stream", name:"飲酒配信（解禁）", kind:"yenBase", baseYenKey:"alcoholBaseYen", tag:"配信" },
    { id:"vending", name:"自販機1本", kind:"yenBase", baseYenKey:"vendingBaseYen", tag:"飲料" },

    { id:"game_3000", name:"ゲーム/DLC（〜3000）", kind:"fixed", pt:300, tag:"ゲーム" },
    { id:"game_5000", name:"ゲーム/DLC（〜5000）", kind:"fixed", pt:500, tag:"ゲーム" },
    { id:"game_8000", name:"ゲーム/DLC（〜8000）", kind:"fixed", pt:800, tag:"ゲーム" },
    { id:"game_10000", name:"ゲーム/DLC（8001〜）", kind:"fixed", pt:1000, tag:"ゲーム" },

    { id:"amz_2000", name:"Amazon（〜2000）", kind:"fixed", pt:200, tag:"買い物" },
    { id:"amz_5000", name:"Amazon（〜5000）", kind:"fixed", pt:500, tag:"買い物" },
    { id:"amz_8000", name:"Amazon（〜8000）", kind:"fixed", pt:800, tag:"買い物" },
    { id:"amz_10000", name:"Amazon（〜10000）", kind:"fixed", pt:1000, tag:"買い物" },
    { id:"amz_15000", name:"Amazon（10001〜）", kind:"fixed", pt:1500, tag:"買い物" },        { id:"clearcare_lotion", name:"クリアケア化粧水 300mL（特価）", kind:"yen", yen:1690, discountKey:"skinDiscount", tag:"スキンケア" },
    { id:"clearcare_gel", name:"クリアケアオールインワンジェル 200g（特価）", kind:"yen", yen:2290, discountKey:"skinDiscount", tag:"スキンケア" },

{ id:"snack", name:"コンビニお菓子", kind:"fixed", pt:30, tag:"嗜好" },
    { id:"ice", name:"コンビニアイス", kind:"fixed", pt:40, tag:"嗜好" },

    { id:"tranoko_500", name:"トラノコ 500円", kind:"fixed", pt:50, tag:"投資" },
    { id:"pcsave_500", name:"PC貯金 500円", kind:"fixed", pt:50, tag:"貯金" },

    { id:"daytrip", name:"日帰り旅行", kind:"fixed", pt:2000, tag:"旅行" },
    { id:"event_trip", name:"イベント遠征（ライブ等）", kind:"fixed", pt:3500, tag:"旅行" },
    { id:"longtrip", name:"長距離旅行", kind:"fixed", pt:6000, tag:"旅行" },
  ];
}

function storeItemsAll() {
  const baseBuilt = builtinStoreItems();
  const ov = state.custom.builtinStoreOverrides || {};
  const built = baseBuilt
    .filter(it => !(ov[it.id] && ov[it.id].hidden))
    .map(it => {
      const o = ov[it.id];
      if (!o) return it;
      const out = { ...it };
      if (o.name) out.name = o.name;
      if (out.kind === "fixed" && typeof o.pt === "number") out.pt = o.pt;
      return out;
    });
  const custom = (state.custom.stores || []).map(x => ({
    id: x.id,
    name: x.name,
    kind:
      x.type === "fixed" ? "fixed" :
      x.type === "yenBase" ? "yenBaseCustom" :
      "yenCustom",
    pt: x.pt,
    baseYen: x.baseYen,
    yen: x.yen,
    discount: x.discount,
    tag: x.tag || "カスタム"
  }));
  return { built, custom };
}

function itemCostPt(item) {
  const c = state.config;
  if (item.kind === "fixed") return parseNum(item.pt, 0);

  if (item.kind === "yen") {
    const disc = item.discountKey ? parseNum(c[item.discountKey], 1) : 1;
    const raw = (parseNum(item.yen, 0) / c.yenPerPt) * disc;
    return roundToStep(raw, c.roundStep);
  }

  if (item.kind === "yenBase") {
    const baseY = parseNum(c[item.baseYenKey], 0);
    const raw = baseY / c.yenPerPt;
    return roundToStep(raw, c.roundStep);
  }

  if (item.kind === "yenBaseCustom") {
    const raw = parseNum(item.baseYen, 0) / c.yenPerPt;
    return roundToStep(raw, c.roundStep);
  }

  if (item.kind === "yenCustom") {
    const disc = parseNum(item.discount, 1);
    const raw = (parseNum(item.yen, 0) / c.yenPerPt) * disc;
    return roundToStep(raw, c.roundStep);
  }

  return 0;
}

function maxStorePricePt() {
  const { built, custom } = storeItemsAll();
  let mx = 0;
  for (const it of built) mx = Math.max(mx, itemCostPt(it));
  for (const it of custom) mx = Math.max(mx, itemCostPt(it));
  return mx;
}

/* ---------- Balance apply ---------- */
function applyDeltaToBalances(delta) {
  const b = state.balances;
  const d = parseNum(delta, 0);

  let balance = parseNum(b.balance, 0);
  let debt = parseNum(b.debt, 0);

  if (d > 0) {
    const repay = Math.min(debt, d);
    debt -= repay;
    balance += (d - repay);
    b.lifetimeEarned = Math.round((parseNum(b.lifetimeEarned, 0) + d) * 10) / 10;
  } else if (d < 0) {
    balance += d;
  }

  b.balance = Math.round(balance * 10) / 10;
  b.debt = Math.round(debt * 10) / 10;
}

/* ---------- Scoring ---------- */
function prevDayKey(dateStr) {
  const d0 = new Date(dateStr + "T00:00:00");
  const d1 = new Date(d0); d1.setDate(d1.getDate() - 1);
  return ymd(d1);
}

function computeBuiltinDelta(dateStr, draft) {
  const c = state.config;
  const lines = [];
  const addLine = (label, pts) => {
    if (!pts || Math.abs(pts) < 0.0001) return;
    lines.push({ label, pts: Math.round(pts * 10) / 10 });
  };

  // 習慣
  addLine(`歯磨き×${draft.tooth}`, draft.tooth * c.toothPt);
  addLine(`スキンケア×${draft.skin}`, draft.skin * c.skinPt);
  addLine(`ウォーターフロッサー×${draft.water}`, draft.water * c.waterPt);
  addLine(`日記×${draft.diary}`, draft.diary * c.diaryPt);

  // 継続（加点）
  addLine(`机×${draft.desk}`, draft.desk * c.deskPtPer);
  addLine(`床×${draft.floor}`, draft.floor * c.floorPtPer);
  addLine(`ゴミ袋OK`, draft.trashOk ? c.trashOkPt : 0);

  // 継続（前日悪化ペナルティ）
  const yk = prevDayKey(dateStr);
  const yd = ensureDay(yk).draft;

  const deskDrop = Math.max(0, parseNum(yd.desk,0) - parseNum(draft.desk,0));
  const floorDrop = Math.max(0, parseNum(yd.floor,0) - parseNum(draft.floor,0));
  if (deskDrop) addLine(`机 悪化 -${deskDrop}`, -deskDrop * c.cleanPenaltyPerUnit);
  if (floorDrop) addLine(`床 悪化 -${floorDrop}`, -floorDrop * c.cleanPenaltyPerUnit);

  const trashDrop = (parseNum(yd.trashOk,0) === 1 && parseNum(draft.trashOk,0) === 0);
  if (trashDrop) addLine(`ゴミ袋 悪化`, -c.trashDropPenalty);

  // 時間・数値
  const mos = parseNum(draft.mosMin, 0);
  const gui = parseNum(draft.guitarMin, 0);
  const nap = parseNum(draft.napHour, 0);
  const diff = parseNum(draft.scoreDiff, 0);

  addLine(`MOS ${mos}分`, mos * c.mosPerMin);
  addLine(`ギター ${gui}分`, gui * c.guitarPerMin);
  addLine(`昼寝 ${nap}時間`, nap * c.napPerHour);

  if (diff !== 0) {
    if (diff > 0) addLine(`平均差 +${diff}`, diff * c.scorePosMul);
    else addLine(`平均差 ${diff}`, -Math.abs(diff) * c.scoreNegMul);
  }

  // 課題
  const fc = parseNum(draft.forgotCount, 0);
  const sc = parseNum(draft.sameDayCount, 0);
  if (fc) addLine(`課題出し忘れ×${fc}`, fc * c.forgotPt);
  if (sc) addLine(`当日提出×${sc}`, sc * c.sameDayPt);

  const tAdd = parseNum(draft.taskAdd, 0);
  const tDone = parseNum(draft.taskDone, 0);
  addLine(`課題追加×${tAdd}`, tAdd * c.taskAddPt);
  addLine(`課題完了×${tDone}`, tDone * c.taskDonePt);

  const total = lines.reduce((a, x) => a + x.pts, 0);
  return { total: Math.round(total * 10) / 10, lines };
}

function computeCustomDelta(dateStr, customDraft) {
  const items = state.custom.inputs || [];
  const lines = [];
  const addLine = (label, pts) => {
    if (!pts || Math.abs(pts) < 0.0001) return;
    lines.push({ label, pts: Math.round(pts * 10) / 10 });
  };

  const yk = prevDayKey(dateStr);
  const ycd = ensureDay(yk).customDraft || {};

  for (const it of items) {
    const vRaw = customDraft[it.id];
    const v = (it.type === "toggle" || it.type === "stepper") ? parseNum(vRaw, 0) : parseNum(vRaw, 0);

    if (it.type === "toggle") {
      const pts = v ? parseNum(it.coef, 0) : 0;
      if (v) addLine(`${it.name}`, pts);

      if (it.prevPenaltyOn) {
        const yv = parseNum(ycd[it.id], 0);
        if (yv === 1 && v === 0) addLine(`${it.name} 悪化`, -Math.abs(parseNum(it.prevDropPenalty, 0)));
      }
      continue;
    }

    if (it.type === "stepper") {
      const pts = v * parseNum(it.coef, 0);
      if (v) addLine(`${it.name}×${v}`, pts);

      if (it.prevPenaltyOn) {
        const yv = parseNum(ycd[it.id], 0);
        const drop = Math.max(0, yv - v);
        if (drop) addLine(`${it.name} 悪化 -${drop}`, -drop * Math.abs(parseNum(it.prevPenaltyPer, 0)));
      }
      continue;
    }

    if (it.type === "number") {
      let pts = 0;
      if (it.signSplit) {
        if (v > 0) pts = v * parseNum(it.posCoef, 0);
        else if (v < 0) pts = -Math.abs(v) * parseNum(it.negCoef, 0);
      } else {
        pts = v * parseNum(it.coef, 0);
      }
      if (v !== 0) addLine(`${it.name} ${v}`, pts);

      if (it.prevPenaltyOn) {
        const yv = parseNum(ycd[it.id], 0);
        const drop = Math.max(0, yv - v);
        if (drop) addLine(`${it.name} 悪化 -${drop}`, -drop * Math.abs(parseNum(it.prevPenaltyPer, 0)));
      }
    }
  }

  const total = lines.reduce((a, x) => a + x.pts, 0);
  return { total: Math.round(total * 10) / 10, lines };
}

/* ---------- UI refs ---------- */
const ui = {
  tabs: document.querySelectorAll(".tab"),
  panes: {
    home: $("#tab-home"),
    store: $("#tab-store"),
    settings: $("#tab-settings"),
    files: $("#tab-files"),
  },

  dateInput: $("#dateInput"),
  prevDayBtn: $("#prevDayBtn"),
  nextDayBtn: $("#nextDayBtn"),
  todayBtn: $("#todayBtn"),

  balanceText: $("#balanceText"),
  debtText: $("#debtText"),
  ydayDiffText: $("#ydayDiffText"),
  lastSubmitText: $("#lastSubmitText"),

  goalRemainText: $("#goalRemainText"),
  goalPctText: $("#goalPctText"),
  progressFill: $("#progressFill"),

  // builtin steppers
  toothVal: $("#toothVal"),
  skinVal: $("#skinVal"),
  waterVal: $("#waterVal"),
  diaryVal: $("#diaryVal"),

  deskVal: $("#deskVal"),
  floorVal: $("#floorVal"),
  trashVal: $("#trashVal"),

  // inputs
  mosMin: $("#mosMin"),
  guitarMin: $("#guitarMin"),
  napHour: $("#napHour"),
  scoreDiff: $("#scoreDiff"),
  forgotCountVal: $("#forgotCountVal"),
  sameDayCountVal: $("#sameDayCountVal"),
taskAdd: $("#taskAdd"),
  taskDone: $("#taskDone"),

  customInputsArea: $("#customInputsArea"),
  todayMiniLog: $("#todayMiniLog"),

  submitBtn: $("#submitBtn"),

  // store
  storeList: $("#storeList"),
  customStoreList: $("#customStoreList"),

  // settings - base
  yenPerPt: $("#yenPerPt"),
  roundStep: $("#roundStep"),
  goalPt: $("#goalPt"),
  vendingBaseYen: $("#vendingBaseYen"),
  alcoholBaseYen: $("#alcoholBaseYen"),
  skinDiscount: $("#skinDiscount"),

  mosPerMin: $("#mosPerMin"),
  guitarPerMin: $("#guitarPerMin"),
  napPerHour: $("#napPerHour"),
  toothPt: $("#toothPt"),
  waterPt: $("#waterPt"),
  skinPt: $("#skinPt"),
  diaryPt: $("#diaryPt"),
  taskAddPt: $("#taskAddPt"),
  taskDonePt: $("#taskDonePt"),
  forgotPt: $("#forgotPt"),
  sameDayPt: $("#sameDayPt"),
  scorePosMul: $("#scorePosMul"),
  scoreNegMul: $("#scoreNegMul"),
  cleanPenaltyPerUnit: $("#cleanPenaltyPerUnit"),
  trashDropPenalty: $("#trashDropPenalty"),

  adjustPt: $("#adjustPt"),
  adjustMemo: $("#adjustMemo"),
  adjustBtn: $("#adjustBtn"),

  // add item panels
  addInputTabBtn: $("#addInputTabBtn"),
  addStoreTabBtn: $("#addStoreTabBtn"),
  addInputPanel: $("#addInputPanel"),
  addStorePanel: $("#addStorePanel"),

  // custom input form
  ciName: $("#ciName"),
  ciType: $("#ciType"),
  ciMax: $("#ciMax"),
  ciCoef: $("#ciCoef"),
  ciSignSplit: $("#ciSignSplit"),
  ciSignArea: $("#ciSignArea"),
  ciPosCoef: $("#ciPosCoef"),
  ciNegCoef: $("#ciNegCoef"),
  ciPrevPenaltyOn: $("#ciPrevPenaltyOn"),
  ciPrevPenaltyArea: $("#ciPrevPenaltyArea"),
  ciPrevPenaltyPer: $("#ciPrevPenaltyPer"),
  ciPrevDropPenalty: $("#ciPrevDropPenalty"),
  ciSaveBtn: $("#ciSaveBtn"),
  ciClearBtn: $("#ciClearBtn"),
  customInputsList: $("#customInputsList"),

  // custom store form
  csName: $("#csName"),
  csType: $("#csType"),
  csPt: $("#csPt"),
  csBaseYen: $("#csBaseYen"),
  csYen: $("#csYen"),
  csDiscount: $("#csDiscount"),
  csTag: $("#csTag"),
  csSaveBtn: $("#csSaveBtn"),
  csClearBtn: $("#csClearBtn"),
  customStoresList: $("#customStoresList"),
  builtinStoresList: $("#builtinStoresList"),
  bsShowAllBtn: $("#bsShowAllBtn"),

  // files
  exportCsvBtn: $("#exportCsvBtn"),
  exportJsonBtn: $("#exportJsonBtn"),
  importJson: $("#importJson"),

  // debt banner + consult copy
  debtBanner: $("#debtBanner"),
  copyConsultBtn: $("#copyConsultBtn"),

  // modal
  modal: $("#modal"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  modalClose: $("#modalClose"),
  modalCancel: $("#modalCancel"),
  modalOk: $("#modalOk"),
};

let currentDate = ymd(new Date());
ensureDay(currentDate);

/* ---------- Tabs ---------- */
ui.tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    ui.tabs.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const t = btn.dataset.tab;
    Object.entries(ui.panes).forEach(([k, pane]) => {
      pane.classList.toggle("hidden", k !== t);
    });
    if (t === "store") renderStore();
    if (t === "settings") renderSettings();
  });
});

/* ---------- Date nav ---------- */
function setDate(dateStr) {
  currentDate = dateStr;
  ensureDay(currentDate);
  ui.dateInput.value = currentDate;
  loadDraftToUI();
  renderHeader();
  renderMiniLog();
  renderDebtBanner();
  renderCustomInputsHome();
}
ui.dateInput.addEventListener("change", () => setDate(ui.dateInput.value));
let __navBusy = false;
function navByDays(delta) {
  if (__navBusy) return;
  __navBusy = true;
  const d = new Date(currentDate + "T00:00:00");
  d.setDate(d.getDate() + delta);
  setDate(ymd(d));
  setTimeout(() => { __navBusy = false; }, 120);
}

ui.todayBtn.onclick = (e) => { e?.preventDefault?.(); setDate(ymd(new Date())); };
ui.prevDayBtn.onclick = (e) => { e?.preventDefault?.(); navByDays(-1); };
ui.nextDayBtn.onclick = (e) => { e?.preventDefault?.(); navByDays(1); };

// まれにclickが発火しない環境向けの保険
ui.prevDayBtn.addEventListener("pointerup", () => navByDays(-1));
ui.nextDayBtn.addEventListener("pointerup", () => navByDays(1));
/* ---------- Steppers (builtin) ---------- */
function setValClass(el, v) {
  el.textContent = String(v);
  el.classList.toggle("on", parseNum(v,0) > 0);
}

document.querySelectorAll("[data-step]").forEach((b) => {
  b.addEventListener("click", () => {
    const key = b.dataset.step;
    const dlt = parseInt(b.dataset.d, 10);
    const day = ensureDay(currentDate);

    if (["tooth","skin","water","diary","desk","floor","trashOk","forgotCount","sameDayCount"].includes(key)) {
      const max =
        (key === "tooth" || key === "skin") ? 2 :
        (key === "desk") ? 5 :
        (key === "floor") ? 2 :
        (key === "forgotCount" || key === "sameDayCount") ? 20 :
        1;

      day.draft[key] = clamp((day.draft[key] ?? 0) + dlt, 0, max);
      saveState();
      loadDraftToUI(false);
      renderMiniLog();
      return;
    }
  });
});

/* ---------- Inputs change (builtin) ---------- */
function bindDraftInput(inputEl, key) {
  inputEl.addEventListener("input", () => {
    const day = ensureDay(currentDate);
    day.draft[key] = inputEl.value;
    saveState();
    renderMiniLog();
  });
}
bindDraftInput(ui.mosMin, "mosMin");
bindDraftInput(ui.guitarMin, "guitarMin");
bindDraftInput(ui.napHour, "napHour");
bindDraftInput(ui.scoreDiff, "scoreDiff");
bindDraftInput(ui.taskAdd, "taskAdd");
bindDraftInput(ui.taskDone, "taskDone");

/* ---------- Custom inputs render (home) ---------- */
function renderCustomInputsHome() {
  const items = state.custom.inputs || [];
  if (!items.length) {
    ui.customInputsArea.textContent = "（設定 → 追加 から作れます）";
    return;
  }

  const day = ensureDay(currentDate);
  const cd = day.customDraft || {};

  const html = items.map(it => {
    const v = cd[it.id] ?? (it.type === "toggle" ? 0 : "");
    if (it.type === "toggle") {
      return `
        <div class="step">
          <div class="label">${it.name}（0/1）</div>
          <div class="stepper">
            <button class="btn ghost" data-ci-step="${it.id}" data-d="-1">−</button>
            <div id="ci_val_${it.id}" class="val">${parseNum(v,0)}</div>
            <button class="btn ghost" data-ci-step="${it.id}" data-d="1">＋</button>
          </div>
        </div>
      `;
    }
    if (it.type === "stepper") {
      return `
        <div class="step">
          <div class="label">${it.name}（0〜${parseNum(it.max,1)}）</div>
          <div class="stepper">
            <button class="btn ghost" data-ci-step="${it.id}" data-d="-1">−</button>
            <div id="ci_val_${it.id}" class="val">${parseNum(v,0)}</div>
            <button class="btn ghost" data-ci-step="${it.id}" data-d="1">＋</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="field">
        <label>${it.name}（数値）</label>
        <input data-ci-num="${it.id}" type="number" step="0.1" value="${v}" placeholder="0" />
      </div>
    `;
  }).join("");

  ui.customInputsArea.innerHTML = html;

  // bind controls
  ui.customInputsArea.querySelectorAll("[data-ci-step]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.ciStep;
      const dlt = parseInt(btn.dataset.d, 10);
      const it = (state.custom.inputs || []).find(x => x.id === id);
      if (!it) return;

      const day = ensureDay(currentDate);
      const cd = day.customDraft || {};
      const cur = parseNum(cd[id], 0);

      let max = 1;
      if (it.type === "stepper") max = Math.max(0, parseNum(it.max, 1));
      if (it.type === "toggle") max = 1;

      const next = clamp(cur + dlt, 0, max);
      cd[id] = next;
      day.customDraft = cd;

      saveState();
      const valEl = $(`#ci_val_${id}`);
      if (valEl) setValClass(valEl, next);
      renderMiniLog();
    });
  });

  ui.customInputsArea.querySelectorAll("[data-ci-num]").forEach(inp => {
    inp.addEventListener("input", () => {
      const id = inp.dataset.ciNum;
      const day = ensureDay(currentDate);
      day.customDraft[id] = inp.value;
      saveState();
      renderMiniLog();
    });
  });

  // set classes
  items.forEach(it => {
    if (it.type !== "number") {
      const valEl = $(`#ci_val_${it.id}`);
      if (valEl) setValClass(valEl, parseNum(cd[it.id],0));
    }
  });
}

/* ---------- Mini log ---------- */
function renderMiniLog() {
  const day = ensureDay(currentDate);
  const draft = day.draft;
  const parts = [];
  const pushIf = (label, v) => { if (v) parts.push(label + v); };

  if (draft.tooth) parts.push(`歯×${draft.tooth}`);
  if (draft.skin) parts.push(`肌×${draft.skin}`);
  if (draft.water) parts.push(`水×${draft.water}`);
  if (draft.diary) parts.push(`日記×${draft.diary}`);

  if (draft.desk) parts.push(`机${draft.desk}`);
  if (draft.floor) parts.push(`床${draft.floor}`);
  if (draft.trashOk) parts.push(`ゴミOK`);

  const mos = parseNum(draft.mosMin, 0);
  const gui = parseNum(draft.guitarMin, 0);
  const nap = parseNum(draft.napHour, 0);
  const diff = parseNum(draft.scoreDiff, 0);
  if (mos) parts.push(`MOS${mos}分`);
  if (gui) parts.push(`ギター${gui}分`);
  if (nap) parts.push(`昼寝${nap}h`);
  if (diff) parts.push(`差${diff}`);

  const ta = parseNum(draft.taskAdd, 0);
  const td = parseNum(draft.taskDone, 0);
  if (ta) parts.push(`課題+${ta}`);
  if (td) parts.push(`課題完${td}`);

  const fc = parseNum(draft.forgotCount, 0);
  const sc = parseNum(draft.sameDayCount, 0);
  if (fc) parts.push(`未提出×${fc}`);
  if (sc) parts.push(`当日提出×${sc}`);

  // custom
  const items = state.custom.inputs || [];
  const cd = day.customDraft || {};
  for (const it of items) {
    const vRaw = cd[it.id];
    if (it.type === "number") {
      const v = parseNum(vRaw, 0);
      if (v) parts.push(`${it.name}${v}`);
    } else {
      const v = parseNum(vRaw, 0);
      if (v) parts.push(`${it.name}×${v}`);
    }
  }

  ui.todayMiniLog.textContent = parts.length ? parts.join(" / ") : "（まだ入力がありません）";
}

/* ---------- Header / Progress / yday diff ---------- */
function renderHeader() {
  const b = state.balances;
  ui.balanceText.textContent = fmt1(parseNum(b.balance,0));
  ui.debtText.textContent = fmt1(parseNum(b.debt,0));

  const d0 = new Date(currentDate + "T00:00:00");
  const d1 = new Date(d0); d1.setDate(d1.getDate() - 1);
  const diff = daySum(currentDate) - daySum(ymd(d1));
  ui.ydayDiffText.textContent = (diff >= 0 ? "+" : "") + fmt1(diff);

  ui.lastSubmitText.textContent = b.lastSubmitIso ? b.lastSubmitIso.slice(0,16).replace("T"," ") : "—";

  const goal = parseNum(state.config.goalPt, 0);
  const remain = Math.max(0, goal - parseNum(b.balance,0));
  ui.goalRemainText.textContent = fmt1(remain);

  const pct = goal > 0 ? clamp((parseNum(b.balance,0) / goal) * 100, 0, 100) : 0;
  ui.goalPctText.textContent = `${Math.round(pct)}%`;
  ui.progressFill.style.width = `${pct}%`;
}

function renderDebtBanner() {
  const cap = maxStorePricePt();
  const hit = parseNum(state.balances.debt,0) >= cap && cap > 0;
  ui.debtBanner.classList.toggle("hidden", !hit);
}

/* ---------- Load draft to UI ---------- */
function loadDraftToUI(alsoInputs = true) {
  const draft = ensureDay(currentDate).draft;
  setValClass(ui.toothVal, draft.tooth ?? 0);
  setValClass(ui.skinVal, draft.skin ?? 0);
  setValClass(ui.waterVal, draft.water ?? 0);
  setValClass(ui.diaryVal, draft.diary ?? 0);

  setValClass(ui.deskVal, draft.desk ?? 0);
  setValClass(ui.floorVal, draft.floor ?? 0);
  setValClass(ui.trashVal, draft.trashOk ?? 0);

  setValClass(ui.forgotCountVal, draft.forgotCount ?? 0);
  setValClass(ui.sameDayCountVal, draft.sameDayCount ?? 0);

  if (alsoInputs) {
    ui.mosMin.value = draft.mosMin ?? "";
    ui.guitarMin.value = draft.guitarMin ?? "";
    ui.napHour.value = draft.napHour ?? "";
    ui.scoreDiff.value = draft.scoreDiff ?? "";
    ui.taskAdd.value = draft.taskAdd ?? "";
    ui.taskDone.value = draft.taskDone ?? "";
    setValClass(ui.forgotCountVal, draft.forgotCount ?? 0);
    setValClass(ui.sameDayCountVal, draft.sameDayCount ?? 0);
  }
}

/* ---------- Modal ---------- */
let modalResolve = null;
function openModal(title, bodyHtml) {
  ui.modalTitle.textContent = title;
  ui.modalBody.innerHTML = bodyHtml;
  ui.modal.classList.remove("hidden");
  return new Promise((resolve) => (modalResolve = resolve));
}
function closeModal(ok) {
  ui.modal.classList.add("hidden");
  if (modalResolve) modalResolve(ok);
  modalResolve = null;
}
ui.modalClose.onclick = () => closeModal(false);
ui.modalCancel.onclick = () => closeModal(false);
ui.modalOk.onclick = () => closeModal(true);

/* ---------- Submit ---------- */
ui.submitBtn.addEventListener("click", async () => {
  const day = ensureDay(currentDate);

  const builtin = computeBuiltinDelta(currentDate, day.draft);
  const custom = computeCustomDelta(currentDate, day.customDraft);

  const total = Math.round((builtin.total + custom.total) * 10) / 10;
  const lines = [...builtin.lines, ...custom.lines];

  if (!lines.length) {
    await openModal("確認", `<div class="muted">入力が空です。</div>`);
    closeModal(false);
    return;
  }

  // simulate balances
  const sim = { ...state.balances };
  const temp = state.balances;
  state.balances = sim;
  applyDeltaToBalances(total);
  const after = { ...state.balances };
  state.balances = temp;

  const linesHtml = lines.map(x =>
    `<div class="row space"><div>${x.label}</div><div><b>${(x.pts>=0?"+":"")}${fmt1(x.pts)}</b></div></div>`
  ).join("");

  const html = `
    <div class="muted small">日付：${currentDate}</div>
    <div style="margin-top:8px">${linesHtml}</div>
    <hr style="border:none;border-top:1px solid var(--border);margin:10px 0" />
    <div class="row space"><div><b>今回の増減</b></div><div class="price">${(total>=0?"+":"")}${fmt1(total)}</div></div>
    <div class="muted small" style="margin-top:8px">
      反映後：残高 ${fmt1(after.balance)} / 借金 ${fmt1(after.debt)}
    </div>
  `;

  const ok = await openModal("送信して反映しますか？", html);
  if (!ok) return;

  applyDeltaToBalances(total);

  state.balances.lastSubmitIso = nowIso();
  day.logs.push({
    ts: nowIso(),
    type: "submit",
    delta: total,
    lines,
    memo: "",
    balanceAfter: state.balances.balance,
    debtAfter: state.balances.debt
  });

  // reset drafts
  day.draft = defaultDraft();
  day.customDraft = {};
  saveState();

  loadDraftToUI();
  renderCustomInputsHome();
  renderMiniLog();
  renderHeader();
  renderDebtBanner();
});

/* ---------- Store render + purchase ---------- */
function renderStore() {
  const { built, custom } = storeItemsAll();
  const builtWith = built.map(it => ({...it, cost:itemCostPt(it)}));
  const customWith = custom.map(it => ({...it, cost:itemCostPt(it)}));

  ui.storeList.innerHTML = builtWith.map(it => `
    <div class="item">
      <div>
        <h4>${it.name}</h4>
        <div class="pill">${it.tag}</div>
      </div>
      <div class="right">
        <div class="price">${fmt1(it.cost)}</div>
        <button class="btn primary" data-buy="${it.id}" data-kind="built">購入</button>
      </div>
    </div>
  `).join("");

  ui.customStoreList.innerHTML = customWith.length ? customWith.map(it => `
    <div class="item">
      <div>
        <h4>${it.name}</h4>
        <div class="pill">${it.tag || "カスタム"}</div>
      </div>
      <div class="right">
        <div class="price">${fmt1(it.cost)}</div>
        <button class="btn primary" data-buy="${it.id}" data-kind="custom">購入</button>
      </div>
    </div>
  `).join("") : `<div class="muted small">（設定 → 追加 から作れます）</div>`;

  document.querySelectorAll("[data-buy]").forEach(b => {
    b.addEventListener("click", () => buyItem(b.dataset.buy, b.dataset.kind));
  });
}

async function buyItem(id, kind) {
  const { built, custom } = storeItemsAll();
  const list = kind === "custom" ? custom : built;
  const it = list.find(x => x.id === id);
  if (!it) return;

  const cost = itemCostPt(it);
  const cap = maxStorePricePt();

  const bal = parseNum(state.balances.balance,0);
  const debt = parseNum(state.balances.debt,0);
  const needDebt = Math.max(0, cost - bal);
  const debtAfter = debt + needDebt;

  if (debtAfter > cap && cap > 0) {
    await openModal("購入できません", `
      <div class="muted">借金上限（${fmt1(cap)}）を超えます。</div>
      <div class="muted small mt">上限に達している場合は「相談用メモ」をコピーして貼れます。</div>
    `);
    return;
  }

  const html = `
    <div class="muted small">日付：${currentDate}</div>
    <div class="row space mt"><div>${it.name}</div><div class="price">-${fmt1(cost)}</div></div>
    <div class="muted small mt">残高不足分は借金に回ります（全部借金OK）。</div>
    <div class="muted small mt">反映後予測：残高 ${fmt1(Math.max(0, bal - cost))} / 借金 ${fmt1(debtAfter)}</div>
  `;
  const ok = await openModal("ストア購入を確定しますか？", html);
  if (!ok) return;

  const day = ensureDay(currentDate);

  let newBal = bal - cost;
  if (newBal >= 0) {
    state.balances.balance = Math.round(newBal * 10) / 10;
  } else {
    const incDebt = Math.abs(newBal);
    state.balances.balance = 0;
    state.balances.debt = Math.round((debt + incDebt) * 10) / 10;
  }

  state.balances.lastSubmitIso = nowIso();

  day.logs.push({
    ts: nowIso(),
    type: "store",
    delta: -cost,
    lines: [{ label: `購入：${it.name}`, pts: -cost }],
    memo: "",
    balanceAfter: state.balances.balance,
    debtAfter: state.balances.debt
  });

  saveState();
  renderHeader();
  renderDebtBanner();
  renderStore();
}

/* ---------- Settings render/bind ---------- */
function renderSettings() {
  const c = state.config;

  ui.yenPerPt.value = c.yenPerPt;
  ui.roundStep.value = c.roundStep;
  ui.goalPt.value = c.goalPt;
  ui.vendingBaseYen.value = c.vendingBaseYen;
  ui.alcoholBaseYen.value = c.alcoholBaseYen;
  ui.skinDiscount.value = c.skinDiscount;

  ui.mosPerMin.value = c.mosPerMin;
  ui.guitarPerMin.value = c.guitarPerMin;
  ui.napPerHour.value = c.napPerHour;
  ui.toothPt.value = c.toothPt;
  ui.waterPt.value = c.waterPt;
  ui.skinPt.value = c.skinPt;
  ui.diaryPt.value = c.diaryPt;
  ui.taskAddPt.value = c.taskAddPt;
  ui.taskDonePt.value = c.taskDonePt;
  ui.forgotPt.value = c.forgotPt;
  ui.sameDayPt.value = c.sameDayPt;

  ui.scorePosMul.value = c.scorePosMul;
  ui.scoreNegMul.value = c.scoreNegMul;

  ui.cleanPenaltyPerUnit.value = c.cleanPenaltyPerUnit;
  ui.trashDropPenalty.value = c.trashDropPenalty;

  renderCustomLists();
}

function bindConfigInput(el, key, parseFn = (v)=>parseNum(v, 0)) {
  el.addEventListener("change", () => {
    state.config[key] = parseFn(el.value);
    saveState();
    renderHeader();
    renderDebtBanner();
    renderCustomInputsHome();
    renderMiniLog();
    if (!ui.panes.store.classList.contains("hidden")) renderStore();
  });
}

bindConfigInput(ui.yenPerPt, "yenPerPt", (v)=>Math.max(1, parseNum(v, 10)));
bindConfigInput(ui.roundStep, "roundStep", (v)=>Math.max(0.1, parseNum(v, 10)));
bindConfigInput(ui.goalPt, "goalPt", (v)=>Math.max(0, parseNum(v, 0)));
bindConfigInput(ui.vendingBaseYen, "vendingBaseYen", (v)=>Math.max(0, parseNum(v, 180)));
bindConfigInput(ui.alcoholBaseYen, "alcoholBaseYen", (v)=>Math.max(0, parseNum(v, 1000)));
bindConfigInput(ui.skinDiscount, "skinDiscount", (v)=>clamp(parseNum(v,0.8), 0.1, 1));

bindConfigInput(ui.mosPerMin, "mosPerMin");
bindConfigInput(ui.guitarPerMin, "guitarPerMin");
bindConfigInput(ui.napPerHour, "napPerHour");
bindConfigInput(ui.toothPt, "toothPt");
bindConfigInput(ui.waterPt, "waterPt");
bindConfigInput(ui.skinPt, "skinPt");
bindConfigInput(ui.diaryPt, "diaryPt");
bindConfigInput(ui.taskAddPt, "taskAddPt");
bindConfigInput(ui.taskDonePt, "taskDonePt");
bindConfigInput(ui.forgotPt, "forgotPt");
bindConfigInput(ui.sameDayPt, "sameDayPt");

bindConfigInput(ui.scorePosMul, "scorePosMul");
bindConfigInput(ui.scoreNegMul, "scoreNegMul");
bindConfigInput(ui.cleanPenaltyPerUnit, "cleanPenaltyPerUnit", (v)=>Math.max(0, parseNum(v,2)));
bindConfigInput(ui.trashDropPenalty, "trashDropPenalty", (v)=>Math.max(0, parseNum(v,3)));

/* ---------- Adjustment ---------- */
ui.adjustBtn.addEventListener("click", async () => {
  const pt = parseNum(ui.adjustPt.value, 0);
  const memo = (ui.adjustMemo.value || "").trim();
  if (!memo) { await openModal("エラー", `<div class="muted">理由（メモ）は必須です。</div>`); return; }
  if (!pt) { await openModal("エラー", `<div class="muted">調整ptが0です。</div>`); return; }

  const sim = { ...state.balances };
  const temp = state.balances;
  state.balances = sim;
  applyDeltaToBalances(pt);
  const after = { ...state.balances };
  state.balances = temp;

  const html = `
    <div class="muted small">日付：${currentDate}</div>
    <div class="row space mt"><div>調整</div><div class="price">${(pt>=0?"+":"")}${fmt1(pt)}</div></div>
    <div class="muted small mt">理由：${memo}</div>
    <div class="muted small mt">反映後：残高 ${fmt1(after.balance)} / 借金 ${fmt1(after.debt)}</div>
  `;
  const ok = await openModal("調整を確定しますか？", html);
  if (!ok) return;

  applyDeltaToBalances(pt);
  state.balances.lastSubmitIso = nowIso();

  const day = ensureDay(currentDate);
  day.logs.push({
    ts: nowIso(),
    type: "adjust",
    delta: pt,
    lines: [{ label: `調整：${memo}`, pts: pt }],
    memo,
    balanceAfter: state.balances.balance,
    debtAfter: state.balances.debt
  });

  ui.adjustPt.value = "";
  ui.adjustMemo.value = "";
  saveState();
  renderHeader();
  renderDebtBanner();
});

/* ---------- Files export/import ---------- */
function makeCsv() {
  const rows = [["date","time","type","delta_pt","balance_pt","debt_pt","lifetimeEarned_pt","memo"]];
  const dates = Object.keys(state.days).sort();
  for (const dt of dates) {
    const logs = state.days[dt]?.logs ?? [];
    for (const lg of logs) {
      const t = (lg.ts || "").slice(11,19);
      rows.push([
        dt,
        t,
        lg.type || "",
        String(lg.delta ?? ""),
        String(lg.balanceAfter ?? ""),
        String(lg.debtAfter ?? ""),
        String(state.balances.lifetimeEarned ?? ""),
        (lg.memo || "")
      ]);
    }
  }
  return rows.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
}

function download(text, filename, mime="text/plain") {
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

ui.exportCsvBtn.addEventListener("click", () => {
  download(makeCsv(), `points_${currentDate}.csv`, "text/csv");
});
ui.exportJsonBtn.addEventListener("click", () => {
  download(JSON.stringify(state, null, 2), `points_${currentDate}.json`, "application/json");
});
ui.importJson.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const txt = await f.text();
  try {
    const st = migrateState(JSON.parse(txt));
    state = st;
    saveState();
    setDate(currentDate);
    renderHeader();
    renderDebtBanner();
    await openModal("OK", `<div class="muted">JSONを読み込みました。</div>`);
  } catch {
    await openModal("エラー", `<div class="muted">読み込みに失敗しました。</div>`);
  } finally {
    ui.importJson.value = "";
  }
});

/* ---------- Consult memo copy ---------- */
ui.copyConsultBtn.addEventListener("click", async () => {
  const cap = maxStorePricePt();
  const b = state.balances;

  const d0 = new Date(currentDate + "T00:00:00");
  const sums = [];
  for (let i=0;i<7;i++){
    const d = new Date(d0); d.setDate(d.getDate()-i);
    const ds = ymd(d);
    const s = daySum(ds);
    sums.push(`${ds}: ${s >= 0 ? "+" : ""}${fmt1(s)}`);
  }

  const memo =
`【相談用メモ】
日付: ${currentDate}
残高: ${fmt1(parseNum(b.balance,0))}
借金: ${fmt1(parseNum(b.debt,0))} / 上限: ${fmt1(cap)}
前日比(前日): ${(daySum(currentDate)-daySum(prevDayKey(currentDate)))>=0?"+":""}${fmt1(daySum(currentDate)-daySum(prevDayKey(currentDate)))}
前回送信: ${b.lastSubmitIso ? b.lastSubmitIso : "—"}

直近7日（日合計）:
${sums.join("\n")}
`;

  await navigator.clipboard.writeText(memo);
  await openModal("コピー完了", `<div class="muted">相談用メモをクリップボードにコピーしました。</div>`);
});

/* ---------- Add panels toggle ---------- */
ui.addInputTabBtn.addEventListener("click", () => {
  ui.addInputPanel.classList.remove("hidden");
  ui.addStorePanel.classList.add("hidden");
  ui.addInputTabBtn.classList.add("primary");
  ui.addStoreTabBtn.classList.remove("primary");
});
ui.addStoreTabBtn.addEventListener("click", () => {
  ui.addStorePanel.classList.remove("hidden");
  ui.addInputPanel.classList.add("hidden");
  ui.addStoreTabBtn.classList.add("primary");
  ui.addInputTabBtn.classList.remove("primary");
});

if (ui.bsShowAllBtn) ui.bsShowAllBtn.addEventListener("click", () => {
  state.custom.builtinStoreOverrides = {};
  saveState();
  renderBuiltinStoresManage();
  if (!ui.panes.store.classList.contains("hidden")) renderStore();
});

/* ---------- Custom input form helpers ---------- */
ui.ciSignSplit.addEventListener("change", () => {
  ui.ciSignArea.classList.toggle("hidden", !ui.ciSignSplit.checked);
});
ui.ciPrevPenaltyOn.addEventListener("change", () => {
  ui.ciPrevPenaltyArea.classList.toggle("hidden", !ui.ciPrevPenaltyOn.checked);
});

function clearCiForm() {
  state.custom.editing.ci = null;
  ui.ciName.value = "";
  ui.ciType.value = "toggle";
  ui.ciMax.value = 1;
  ui.ciCoef.value = 1;

  ui.ciSignSplit.checked = false;
  ui.ciSignArea.classList.add("hidden");
  ui.ciPosCoef.value = 0.1;
  ui.ciNegCoef.value = 0.5;

  ui.ciPrevPenaltyOn.checked = false;
  ui.ciPrevPenaltyArea.classList.add("hidden");
  ui.ciPrevPenaltyPer.value = 2;
  ui.ciPrevDropPenalty.value = 3;
}
ui.ciClearBtn.addEventListener("click", () => {
  clearCiForm();
  saveState();
});

ui.ciSaveBtn.addEventListener("click", async () => {
  const name = (ui.ciName.value || "").trim();
  if (!name) { await openModal("エラー", `<div class="muted">名前は必須です。</div>`); return; }

  const type = ui.ciType.value;
  const max = Math.max(1, parseNum(ui.ciMax.value, 1));
  const coef = parseNum(ui.ciCoef.value, 0);

  const signSplit = !!ui.ciSignSplit.checked;
  const posCoef = parseNum(ui.ciPosCoef.value, 0);
  const negCoef = parseNum(ui.ciNegCoef.value, 0);

  const prevPenaltyOn = !!ui.ciPrevPenaltyOn.checked;
  const prevPenaltyPer = Math.max(0, parseNum(ui.ciPrevPenaltyPer.value, 0));
  const prevDropPenalty = Math.max(0, parseNum(ui.ciPrevDropPenalty.value, 0));

  const editingId = state.custom.editing.ci;

  if (editingId) {
    const it = state.custom.inputs.find(x => x.id === editingId);
    if (!it) return;
    Object.assign(it, { name, type, max, coef, signSplit, posCoef, negCoef, prevPenaltyOn, prevPenaltyPer, prevDropPenalty });
  } else {
    state.custom.inputs.push({
      id: rid("ci"),
      name, type,
      max, coef,
      signSplit, posCoef, negCoef,
      prevPenaltyOn, prevPenaltyPer, prevDropPenalty
    });
  }

  clearCiForm();
  saveState();
  renderCustomLists();
  renderCustomInputsHome();
  renderMiniLog();
});

function editCustomInput(id) {
  const it = state.custom.inputs.find(x => x.id === id);
  if (!it) return;
  state.custom.editing.ci = id;

  ui.ciName.value = it.name;
  ui.ciType.value = it.type;
  ui.ciMax.value = it.max ?? 1;
  ui.ciCoef.value = it.coef ?? 1;

  ui.ciSignSplit.checked = !!it.signSplit;
  ui.ciSignArea.classList.toggle("hidden", !ui.ciSignSplit.checked);
  ui.ciPosCoef.value = it.posCoef ?? 0.1;
  ui.ciNegCoef.value = it.negCoef ?? 0.5;

  ui.ciPrevPenaltyOn.checked = !!it.prevPenaltyOn;
  ui.ciPrevPenaltyArea.classList.toggle("hidden", !ui.ciPrevPenaltyOn.checked);
  ui.ciPrevPenaltyPer.value = it.prevPenaltyPer ?? 2;
  ui.ciPrevDropPenalty.value = it.prevDropPenalty ?? 3;

  saveState();
}

async function deleteCustomInput(id) {
  const it = state.custom.inputs.find(x => x.id === id);
  if (!it) return;

  const ok = await openModal("削除しますか？", `<div class="muted">入力項目「${it.name}」を削除します。</div>`);
  if (!ok) return;

  state.custom.inputs = state.custom.inputs.filter(x => x.id !== id);

  // 既存の各日の draft からも削除（任意：残しても問題ないが軽く掃除）
  for (const k of Object.keys(state.days)) {
    const d = state.days[k];
    if (d.customDraft) delete d.customDraft[id];
  }

  if (state.custom.editing.ci === id) state.custom.editing.ci = null;

  saveState();
  renderCustomLists();
  renderCustomInputsHome();
  renderMiniLog();
}

/* ---------- Custom store form helpers ---------- */
function clearCsForm() {
  state.custom.editing.cs = null;
  ui.csName.value = "";
  ui.csType.value = "fixed";
  ui.csPt.value = 100;
  ui.csBaseYen.value = 500;
  ui.csYen.value = 1000;
  ui.csDiscount.value = 1;
  ui.csTag.value = "";
}
ui.csClearBtn.addEventListener("click", () => {
  clearCsForm();
  saveState();
});

ui.csSaveBtn.addEventListener("click", async () => {
  const name = (ui.csName.value || "").trim();
  if (!name) { await openModal("エラー", `<div class="muted">名前は必須です。</div>`); return; }

  const type = ui.csType.value;
  const pt = Math.max(0, parseNum(ui.csPt.value, 0));
  const baseYen = Math.max(0, parseNum(ui.csBaseYen.value, 0));
  const yen = Math.max(0, parseNum(ui.csYen.value, 0));
  const discount = clamp(parseNum(ui.csDiscount.value, 1), 0.1, 1);
  const tag = (ui.csTag.value || "").trim();

  const editingId = state.custom.editing.cs;

  if (editingId) {
    const it = state.custom.stores.find(x => x.id === editingId);
    if (!it) return;
    Object.assign(it, { name, type, pt, baseYen, yen, discount, tag });
  } else {
    state.custom.stores.push({
      id: rid("cs"),
      name, type, pt, baseYen, yen, discount, tag
    });
  }

  clearCsForm();
  saveState();
  renderCustomLists();
  if (!ui.panes.store.classList.contains("hidden")) renderStore();
});

function editCustomStore(id) {
  const it = state.custom.stores.find(x => x.id === id);
  if (!it) return;
  state.custom.editing.cs = id;

  ui.csName.value = it.name;
  ui.csType.value = it.type;
  ui.csPt.value = it.pt ?? 0;
  ui.csBaseYen.value = it.baseYen ?? 0;
  ui.csYen.value = it.yen ?? 0;
  ui.csDiscount.value = it.discount ?? 1;
  ui.csTag.value = it.tag ?? "";

  saveState();
}

async function deleteCustomStore(id) {
  const it = state.custom.stores.find(x => x.id === id);
  if (!it) return;

  const ok = await openModal("削除しますか？", `<div class="muted">ストア商品「${it.name}」を削除します。</div>`);
  if (!ok) return;

  state.custom.stores = state.custom.stores.filter(x => x.id !== id);
  if (state.custom.editing.cs === id) state.custom.editing.cs = null;

  saveState();
  renderCustomLists();
  if (!ui.panes.store.classList.contains("hidden")) renderStore();
}


function renderBuiltinStoresManage() {
  if (!ui.builtinStoresList) return;
  const base = builtinStoreItems();
  const ov = state.custom.builtinStoreOverrides || {};
  const built = base.map(it => {
    const o = ov[it.id] || null;
    const hidden = !!(o && o.hidden);
    const name = (o && o.name) ? o.name : it.name;
    const pt = (it.kind === "fixed")
      ? (typeof (o && o.pt) === "number" ? o.pt : parseNum(it.pt, 0))
      : null;
    const cost = itemCostPt({ ...it, name, pt: pt ?? it.pt }); // for display
    return { ...it, name, pt, hidden, cost, hasOverride: !!o };
  });

  ui.builtinStoresList.innerHTML = built.map(it => `
    <div class="rowline ${it.hidden ? "muted" : ""}">
      <div>
        <div class="name">${it.name}${it.hidden ? "（非表示）" : ""}</div>
        <div class="muted small">${it.tag} / ${it.kind === "fixed" ? `pt ${fmt1(it.pt)}（表示コスト ${fmt1(it.cost)}）` : `表示コスト ${fmt1(it.cost)}`}</div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-bs-edit="${it.id}">編集</button>
        <button class="btn ghost" data-bs-toggle="${it.id}">${it.hidden ? "表示" : "非表示"}</button>
        ${it.hasOverride ? `<button class="btn ghost" data-bs-reset="${it.id}">戻す</button>` : ``}
      </div>
    </div>
  `).join("");

  ui.builtinStoresList.querySelectorAll("[data-bs-toggle]").forEach(b => {
    b.addEventListener("click", () => toggleBuiltinStoreHidden(b.dataset.bsToggle));
  });
  ui.builtinStoresList.querySelectorAll("[data-bs-edit]").forEach(b => {
    b.addEventListener("click", () => editBuiltinStore(b.dataset.bsEdit));
  });
  ui.builtinStoresList.querySelectorAll("[data-bs-reset]").forEach(b => {
    b.addEventListener("click", () => resetBuiltinStoreOverride(b.dataset.bsReset));
  });
}

function ensureBuiltinOverride(id) {
  if (!state.custom.builtinStoreOverrides) state.custom.builtinStoreOverrides = {};
  if (!state.custom.builtinStoreOverrides[id]) state.custom.builtinStoreOverrides[id] = {};
  return state.custom.builtinStoreOverrides[id];
}

function toggleBuiltinStoreHidden(id) {
  const o = ensureBuiltinOverride(id);
  o.hidden = !o.hidden;
  saveState();
  renderBuiltinStoresManage();
  if (!ui.panes.store.classList.contains("hidden")) renderStore();
}

function resetBuiltinStoreOverride(id) {
  if (!state.custom.builtinStoreOverrides) return;
  delete state.custom.builtinStoreOverrides[id];
  saveState();
  renderBuiltinStoresManage();
  if (!ui.panes.store.classList.contains("hidden")) renderStore();
}

async function editBuiltinStore(id) {
  const base = builtinStoreItems();
  const it = base.find(x => x.id === id);
  if (!it) return;

  const ov = ensureBuiltinOverride(id);
  const curName = ov.name ?? it.name;
  const curHidden = !!ov.hidden;
  const curPt = (it.kind === "fixed") ? (typeof ov.pt === "number" ? ov.pt : parseNum(it.pt, 0)) : null;

  const html = `
    <div class="field">
      <label>名前</label>
      <input id="bsName" type="text" value="${escapeHtml(curName)}" />
    </div>
    ${it.kind === "fixed" ? `
      <div class="field">
        <label>価格（pt）</label>
        <input id="bsPt" type="number" step="1" value="${fmt1(curPt)}" />
      </div>
    ` : `
      <div class="muted small">※この商品は「${it.kind}」型のため、価格ptの直接変更はできません（換算や基準円を調整してください）。</div>
    `}
    <label class="toggle mt">
      <input id="bsHidden" type="checkbox" ${curHidden ? "checked" : ""} />
      <span>非表示（＝削除扱い）</span>
    </label>
    <div class="muted small mt">※確定後は取り消せます（「戻す」でデフォルトに戻ります）。</div>
  `;
  const ok = await openModal("標準ストア商品を編集", html);
  if (!ok) return;

  const name = (document.getElementById("bsName").value || "").trim();
  const hidden = !!document.getElementById("bsHidden").checked;

  if (name) ov.name = name; else delete ov.name;
  ov.hidden = hidden;

  if (it.kind === "fixed") {
    const pt = Math.max(0, parseNum(document.getElementById("bsPt").value, 0));
    ov.pt = pt;
  }

  saveState();
  renderBuiltinStoresManage();
  if (!ui.panes.store.classList.contains("hidden")) renderStore();
}

function renderCustomLists() {
  renderBuiltinStoresManage();
  // inputs list
  const ins = state.custom.inputs || [];
  if (!ins.length) {
    ui.customInputsList.textContent = "（まだありません）";
  } else {
    ui.customInputsList.innerHTML = ins.map(it => `
      <div class="rowline">
        <div>
          <div class="name">${it.name}</div>
          <div class="meta">type=${it.type}${it.type==="stepper"?` max=${it.max}`:""} / coef=${it.coef}${it.signSplit?` (pos=${it.posCoef}, neg=${it.negCoef})`:""}${it.prevPenaltyOn?` / prev-pen ON`:""}</div>
        </div>
        <div class="btns">
          <button class="btn ghost" data-ci-edit="${it.id}">編集</button>
          <button class="btn" data-ci-del="${it.id}">削除</button>
        </div>
      </div>
    `).join("");

    ui.customInputsList.querySelectorAll("[data-ci-edit]").forEach(b => b.addEventListener("click", () => editCustomInput(b.dataset.ciEdit)));
    ui.customInputsList.querySelectorAll("[data-ci-del]").forEach(b => b.addEventListener("click", () => deleteCustomInput(b.dataset.ciDel)));
  }

  // stores list
  const sts = state.custom.stores || [];
  if (!sts.length) {
    ui.customStoresList.textContent = "（まだありません）";
  } else {
    ui.customStoresList.innerHTML = sts.map(it => `
      <div class="rowline">
        <div>
          <div class="name">${it.name}</div>
          <div class="meta">type=${it.type} / pt=${it.pt} / baseYen=${it.baseYen} / yen=${it.yen} / disc=${it.discount} / tag=${it.tag||""}</div>
        </div>
        <div class="btns">
          <button class="btn ghost" data-cs-edit="${it.id}">編集</button>
          <button class="btn" data-cs-del="${it.id}">削除</button>
        </div>
      </div>
    `).join("");

    ui.customStoresList.querySelectorAll("[data-cs-edit]").forEach(b => b.addEventListener("click", () => editCustomStore(b.dataset.csEdit)));
    ui.customStoresList.querySelectorAll("[data-cs-del]").forEach(b => b.addEventListener("click", () => deleteCustomStore(b.dataset.csDel)));
  }
}

/* ---------- Init ---------- */
ui.dateInput.value = currentDate;

setDate(currentDate);
renderHeader();
renderDebtBanner();
renderCustomInputsHome();
renderMiniLog();
