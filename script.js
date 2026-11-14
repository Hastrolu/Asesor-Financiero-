// ============================================
// CONFIGURACIÓN DEL PIN
// ============================================
// ⚠️ PARA CAMBIAR TU PIN, MODIFICA EL VALOR ENTRE COMILLAS AQUÍ (exactamente 6 dígitos):
const PIN_CODE = '123654';
// ============================================

const STORAGE_KEY = 'financeManagerData';
const CORRUPT_KEY = STORAGE_KEY + '_corrupto';
const BACKUP_REMINDER_DAYS = 30;
const UNDO_DURATION = 5000;
const PAGE_SIZE = 80; // movimientos que se pintan de golpe (el resto con "Ver más")
const DESKTOP = window.matchMedia('(min-width: 900px)');

const DEFAULT_GROUPS = {
    basicos: { name: 'Gastos Básicos', percent: 20, categories: ['Salud', 'Transporte'] },
    ocio: { name: 'Ocio', percent: 15, categories: ['Comida', 'Hobby', 'Suscripciones', 'Ocio', 'Otros'] },
    inversion: { name: 'Inversión', percent: 65, categories: ['Colchón', 'ETFs', 'Acciones', 'Fondos'] }
};
const DEFAULT_ACCOUNTS = ['Efectivo', 'Cuenta Corriente'];
const DEFAULT_INCOME_CATEGORIES = ['Salario', 'Servicio', 'Otros'];
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ============================================
// ESTADO
// ============================================

let data = createDefaultData();
let currentPin = '';
let currentSection = 'inicio';
let editValueCallback = null;
let backupBannerDismissed = false;
let pendingStartupMessage = null;
let lastId = 0;
let wiz = null; // asistente de nuevo movimiento
const listState = { type: 'all', limit: PAGE_SIZE };
const statsState = { mode: 'month', month: null, year: null };

function createDefaultData() {
    return {
        categoryGroups: structuredCloneSafe(DEFAULT_GROUPS),
        accounts: [...DEFAULT_ACCOUNTS],
        incomeCategories: [...DEFAULT_INCOME_CATEGORIES],
        recurring: [],
        lastAccount: null,
        lastBackup: null,
        transactions: []
    };
}

function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
}

// ============================================
// HELPERS
// ============================================

const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const pad = n => String(n).padStart(2, '0');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeText(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// --- Números ---
function makeFormatter(options) {
    try { return new Intl.NumberFormat('es-ES', { useGrouping: 'always', ...options }); }
    catch { return new Intl.NumberFormat('es-ES', options); }
}
const eurFormatter = makeFormatter({ style: 'currency', currency: 'EUR' });
const eurRoundFormatter = makeFormatter({ style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const intFormatter = makeFormatter({ maximumFractionDigits: 0 });

const formatCurrency = amount => eurFormatter.format(amount || 0);
const formatRound = amount => eurRoundFormatter.format(amount || 0);
const formatPercent = (value, decimals = 0) => value === null || !Number.isFinite(value) ? '—' : value.toFixed(decimals) + '%';
const amountToInput = amount => String(amount).replace('.', ',');

// Acepta "12,5", "12.5" y "1.234,56"
function parseAmount(value) {
    let text = String(value ?? '').trim().replace(/\s|€/g, '');
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, ''); // "1.500" = mil quinientos
    if (!/^\d*\.?\d+$/.test(text)) return null;
    return Math.round(parseFloat(text) * 100) / 100;
}

// Tope "redondo" para el eje de una gráfica (1, 2, 2.5, 5 o 10 × potencia de 10)
function niceMax(value) {
    if (!(value > 0)) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(value)));
    return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].map(m => m * power).find(m => value <= m);
}

// --- Fechas ---
const monthKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const getCurrentMonth = () => monthKey(new Date());
const getCurrentYear = () => new Date().getFullYear();
const toISO = date => `${monthKey(date)}-${pad(date.getDate())}`;
const todayISO = () => toISO(new Date());
const monthDate = (month, day = 1) => { const [y, m] = month.split('-').map(Number); return new Date(y, m - 1, day); };
const shiftMonth = (month, delta) => { const d = monthDate(month); d.setMonth(d.getMonth() + delta); return monthKey(d); };
const daysInMonth = month => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const splitDate = iso => ({ month: iso.slice(0, 7), day: Number(iso.slice(8, 10)) });
const formatMonth = month => monthDate(month).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
const monthName = month => monthDate(month).toLocaleDateString('es-ES', { month: 'long' });
const shortMonthName = month => monthDate(month).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
const formatDate = iso => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

function yesterdayISO() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toISO(d);
}

// Día del movimiento. Los antiguos no lo guardaban: se deduce de cuándo se apuntó, si fue ese mismo mes
function txDay(t) {
    if (t.day) return t.day;
    if (t._day === undefined) {
        const created = t.date ? new Date(t.date) : null;
        const value = created && !isNaN(created) && monthKey(created) === t.month ? created.getDate() : null;
        Object.defineProperty(t, '_day', { value, configurable: true, enumerable: false }); // no se guarda en el JSON
    }
    return t._day;
}

function formatTxDate(t, { weekday = false } = {}) {
    const day = txDay(t);
    if (!day) return capitalize(formatMonth(t.month));
    const options = { day: 'numeric', month: 'short' };
    if (weekday) options.weekday = 'short';
    if (!t.month.startsWith(String(getCurrentYear()))) options.year = '2-digit';
    return monthDate(t.month, day).toLocaleDateString('es-ES', options);
}

// --- Categorías y tipos de movimiento ---
const getAllCategories = () => Object.values(data.categoryGroups).flatMap(g => g.categories);
const findCategoryGroup = category => Object.keys(data.categoryGroups).find(key => data.categoryGroups[key].categories.includes(category));
const isInvestmentCategory = category => data.categoryGroups.inversion.categories.includes(category);

// Ajuste de patrimonio (nota "AJUSTE" o "REGULACION"): resta del patrimonio pero no cuenta como gasto
function isAdjustment(t) {
    return /\b(regulacion|ajuste)\b/.test(normalizeText(t.description));
}

// 'income' | 'investment' | 'adjustment' | 'expense'
function txKind(t) {
    if (t.type === 'income') return 'income';
    if (isInvestmentCategory(t.category)) return 'investment';
    return isAdjustment(t) ? 'adjustment' : 'expense';
}

const isIncome = t => t.type === 'income';
const isRealExpense = t => txKind(t) === 'expense';
const inMonth = month => t => t.month === month;
const inYear = year => { const prefix = year + '-'; return t => t.month.startsWith(prefix); };

const txWhere = (...predicates) => data.transactions.filter(t => predicates.every(p => p(t)));
const sumAmounts = list => list.reduce((s, t) => s + t.amount, 0);

function sumBy(list, keyFn) {
    const totals = {};
    list.forEach(t => { const k = keyFn(t); totals[k] = (totals[k] || 0) + t.amount; });
    return totals;
}

// Más reciente primero: mes, día y hora en que se apuntó
function compareTransactions(a, b) {
    return b.month.localeCompare(a.month) || (txDay(b) || 0) - (txDay(a) || 0) || String(b.date || '').localeCompare(String(a.date || ''));
}

// --- HTML repetido ---
function optionsHtml(values, selected) {
    return values.map(v => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

// Añade el valor actual a la lista si ya no existe, para no cambiarlo sin querer al editar
const withCurrent = (list, current) => current && !list.includes(current) ? [...list, current] : list;

function categoryOptionsHtml(type, selected, exclude) {
    if (type === 'income') return optionsHtml(withCurrent(data.incomeCategories, selected), selected);
    let html = Object.values(data.categoryGroups)
        .map(g => `<optgroup label="${escapeHtml(g.name)}">${optionsHtml(g.categories.filter(c => c !== exclude), selected)}</optgroup>`).join('');
    if (selected && !getAllCategories().includes(selected)) html += `<optgroup label="Sin grupo">${optionsHtml([selected], selected)}</optgroup>`;
    return html;
}

// Etiqueta "▲ 12% vs octubre". higherIsBad: en gastos subir es malo
function deltaBadge(current, previous, prevLabel, higherIsBad = true) {
    if (!previous) return '';
    const pct = ((current - previous) / previous) * 100;
    const vs = prevLabel ? ` <span class="delta-vs">vs ${escapeHtml(prevLabel)}</span>` : '';
    if (Math.abs(pct) < 0.5) return `<span class="delta neutral">= igual${vs}</span>`;
    const up = pct > 0;
    return `<span class="delta ${up === higherIsBad ? 'bad' : 'good'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%${vs}</span>`;
}

function barHtml(fraction, cls = '') {
    return `<span class="bar ${cls}"><i style="width:${Math.max(0, Math.min(fraction, 1)) * 100}%"></i></span>`;
}

function emptyHtml(text) {
    return `<p class="empty">${escapeHtml(text)}</p>`;
}

// Línea compacta de un movimiento (desgloses y "gastos más grandes"); se pulsa para editarlo
function miniTxHtml(t, { showCategory = false } = {}) {
    const meta = [showCategory && t.description ? t.category : '', formatTxDate(t), t.account].filter(Boolean).join(' · ');
    return `<div class="mini-tx" data-action="editTransaction" data-id="${t.id}" role="button" tabindex="0">
        <span class="mini-desc">${escapeHtml(t.description || t.category)}</span>
        <span class="mini-meta">${escapeHtml(meta)}</span>
        <span class="mini-amount">${formatCurrency(t.amount)}</span>
    </div>`;
}

// ============================================
// CÁLCULOS
// ============================================

// Resumen de los movimientos que cumplen el filtro, en una sola pasada
function summarize(filter = () => true) {
    let income = 0, expenses = 0, invested = 0, adjustments = 0, count = 0;
    for (const t of data.transactions) {
        if (!filter(t)) continue;
        const kind = txKind(t);
        if (kind === 'income') income += t.amount;
        else if (kind === 'expense') { expenses += t.amount; count++; }
        else if (kind === 'investment') invested += t.amount;
        else adjustments += t.amount;
    }
    const saved = income - expenses;
    return { income, expenses, invested, adjustments, count, saved, savingsRate: income > 0 ? (saved / income) * 100 : null };
}

// Patrimonio = ingresos − gastos − ajustes (lo invertido sigue siendo tuyo). Disponible = patrimonio − invertido
function getPatrimony() {
    const s = summarize();
    const total = s.income - s.expenses - s.adjustments;
    return { total, invested: s.invested, available: total - s.invested };
}

// Periodo (mes o año) con su periodo anterior para comparar.
// Si el periodo es el actual, el anterior se corta en el mismo día: comparar medio mes con un mes entero engaña.
function getPeriod(mode, month, year) {
    const now = new Date(), today = now.getDate(), thisMonth = getCurrentMonth();
    if (mode === 'year') {
        const isCurrent = year === now.getFullYear();
        const monthNum = thisMonth.slice(5);
        const untilToday = t => { const m = t.month.slice(5); return m < monthNum || (m === monthNum && (txDay(t) || 1) <= today); };
        const prevYear = inYear(year - 1);
        const daysTotal = (new Date(year, 11, 31) - new Date(year, 0, 0)) / 86400000;
        return {
            mode, isCurrent, label: String(year), filter: inYear(year),
            prevFilter: isCurrent ? t => prevYear(t) && untilToday(t) : prevYear,
            prevLabel: isCurrent ? `${year - 1} a estas alturas` : String(year - 1),
            daysTotal, daysElapsed: isCurrent ? Math.ceil((now - new Date(year, 0, 0)) / 86400000) : year > now.getFullYear() ? 0 : daysTotal
        };
    }
    const isCurrent = month === thisMonth;
    const prev = shiftMonth(month, -1);
    const daysTotal = daysInMonth(month);
    const partial = isCurrent && today < daysTotal;
    return {
        mode, isCurrent, month, prevMonth: prev, label: capitalize(formatMonth(month)), filter: inMonth(month),
        prevFilter: partial ? t => t.month === prev && (txDay(t) || 1) <= today : inMonth(prev),
        prevLabel: partial ? `${shortMonthName(prev)} a día ${today}` : monthName(prev),
        daysTotal, daysElapsed: isCurrent ? today : month > thisMonth ? 0 : daysTotal
    };
}

// Gastos reales por categoría, de mayor a menor, comparados con el periodo anterior
function categoryRanking(filter, prevFilter) {
    const groups = {};
    txWhere(isRealExpense, filter).forEach(t => (groups[t.category] ||= []).push(t));
    const prev = prevFilter ? sumBy(txWhere(isRealExpense, prevFilter), t => t.category) : {};
    return Object.entries(groups)
        .map(([category, txs]) => ({ category, txs, total: sumAmounts(txs), prev: prev[category] || 0 }))
        .sort((a, b) => b.total - a.total);
}

// ============================================
// DATOS (guardar / cargar)
// ============================================

function loadData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let stored = null;
    try { stored = JSON.parse(raw); } catch (err) { console.error('Datos corruptos', err); }
    if (!stored || typeof stored !== 'object') {
        // Se guarda una copia para poder recuperarlos a mano en vez de sobrescribirlos
        try { localStorage.setItem(CORRUPT_KEY, raw); } catch { /* sin espacio */ }
        pendingStartupMessage = 'No se pudieron leer tus datos guardados. Carga tu último backup desde Ajustes.';
        return;
    }
    const { normalized, orphans, duplicates } = normalizeData(stored);
    data = normalized;
    const messages = [];
    if (orphans.length) messages.push(`Categorías sin grupo movidas a "${data.categoryGroups.ocio.name}": ${orphans.join(', ')}.`);
    if (duplicates.length) messages.push(`Categorías que estaban en dos grupos, arregladas: ${duplicates.join(', ')}.`);
    if (messages.length) {
        saveData();
        pendingStartupMessage = messages.join(' ') + ' Puedes cambiarlas de grupo en Ajustes.';
    }
}

// Completa campos que falten (datos antiguos o importados) y arregla categorías sueltas
function normalizeData(raw) {
    const d = Object.assign(createDefaultData(), raw);
    if (!d.categoryGroups || typeof d.categoryGroups !== 'object') d.categoryGroups = {};
    for (const [key, group] of Object.entries(DEFAULT_GROUPS)) {
        const g = d.categoryGroups[key];
        if (!g || typeof g !== 'object') { d.categoryGroups[key] = structuredCloneSafe(group); continue; }
        if (!Array.isArray(g.categories)) g.categories = [];
        if (!g.name) g.name = group.name;
        g.percent = Number(g.percent) || 0;
    }
    const validList = (list, fallback) => Array.isArray(list) && list.length ? [...new Set(list.map(String))] : [...fallback];
    d.accounts = validList(d.accounts, DEFAULT_ACCOUNTS);
    d.incomeCategories = validList(d.incomeCategories, DEFAULT_INCOME_CATEGORIES);
    if (!Array.isArray(d.recurring)) d.recurring = [];

    d.transactions = (Array.isArray(d.transactions) ? d.transactions : [])
        .filter(t => t && /^\d{4}-\d{2}$/.test(t.month) && (t.type === 'income' || t.type === 'expense'));
    const ids = new Set();
    d.transactions.forEach(t => {
        t.amount = Math.abs(Number(t.amount)) || 0;
        t.category = String(t.category || 'Otros');
        t.account = String(t.account || d.accounts[0]);
        // Sin id o con id repetido no se podría editar el movimiento correcto
        if (!Number.isFinite(t.id) || ids.has(t.id)) t.id = newId();
        ids.add(t.id);
    });

    // Una categoría solo puede estar en un grupo: si sale repetida se queda en el primero
    const seen = new Set(), duplicates = new Set();
    Object.values(d.categoryGroups).forEach(g => {
        g.categories = g.categories.filter(c => {
            if (seen.has(c)) { duplicates.add(c); return false; }
            seen.add(c);
            return true;
        });
    });

    // Gastos cuya categoría no está en ningún grupo → a Ocio, para que cuenten
    const orphans = [...new Set(d.transactions.filter(t => t.type === 'expense' && !seen.has(t.category)).map(t => t.category))];
    d.categoryGroups.ocio.categories.push(...orphans);

    return { normalized: d, orphans, duplicates: [...duplicates] };
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (err) {
        console.error(err);
        showNotification('No se pudo guardar (almacenamiento lleno o bloqueado). Descarga un backup.', 'error', { duration: 8000 });
        return false;
    }
}

function newId() {
    let id = Date.now();
    if (id <= lastId) id = lastId + 1;
    lastId = id;
    return id;
}

// ============================================
// PIN
// ============================================

const isPinScreenActive = () => $('pinScreen').classList.contains('active');

function pinKey(key) {
    $('pinError').classList.remove('show');
    if (key === 'back') currentPin = currentPin.slice(0, -1);
    else if (currentPin.length < 6) currentPin += key;
    updatePinDots();
    if (currentPin.length === 6) setTimeout(checkPin, 150);
}

function updatePinDots() {
    document.querySelectorAll('.pin-dot').forEach((dot, i) => dot.classList.toggle('filled', i < currentPin.length));
}

function checkPin() {
    if (currentPin.length < 6) return;
    if (currentPin === PIN_CODE) { currentPin = ''; unlockApp(); return; }
    $('pinError').classList.add('show');
    navigator.vibrate?.(120);
    currentPin = '';
    updatePinDots();
}

function unlockApp() {
    $('pinScreen').classList.remove('active');
    $('appContainer').classList.add('unlocked');
    refreshAll();
    if (pendingStartupMessage) {
        showNotification(pendingStartupMessage, 'info', { duration: 8000 });
        pendingStartupMessage = null;
    }
}

// ============================================
// INICIALIZACIÓN Y EVENTOS
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    statsState.month = getCurrentMonth();
    statsState.year = getCurrentYear();
    updateMonthFilter(true);

    $('txSearch').addEventListener('input', resetListAndRender);
    $('txMonth').addEventListener('change', () => { resetListAndRender(); renderHomeSide(); });
    $('txCategoryFilter').addEventListener('change', resetListAndRender);
    $('wizDateOther').addEventListener('change', e => { if (wiz && e.target.value) { wiz.date = e.target.value; renderWizDetails(); } });
    $('importFile').addEventListener('change', importData);

    registerServiceWorker();
});

function registerServiceWorker() {
    // Solo funciona servido por http(s), no abriendo el archivo directamente (file://)
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('Service worker no registrado:', err));
}

// Al volver a la app (o cambiar de día con ella abierta) se repinta con la fecha de hoy
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isPinScreenActive() && !modalStack.length) refreshAll();
});

// Cambios hechos en otra pestaña
window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    loadData();
    if (!isPinScreenActive()) refreshAll();
});

// Móvil ↔ escritorio: algunas gráficas enseñan más o menos datos
DESKTOP.addEventListener('change', () => { if (!isPinScreenActive()) renderSection(currentSection); });

const ACTIONS = {
    pin: d => pinKey(d.value),
    nav: d => showSection(d.value),
    addTx: d => openAddTransaction(d.value),
    closeModal: d => closeModal(d.value),
    details: d => showDetailsPopup(d.value),
    txType: d => { listState.type = d.value; resetListAndRender(); },
    txMore: () => { listState.limit += PAGE_SIZE; renderTransactions(); },
    editTransaction: d => openEditTransaction(Number(d.id)),
    deleteEditedTransaction: () => deleteEditedTransaction(),
    duplicateTransaction: () => duplicateTransaction(),
    // Estadísticas
    statsMode: d => { statsState.mode = d.value; renderStats(); },
    statsShift: d => shiftStatsPeriod(Number(d.value)),
    statsToday: () => { statsState.month = getCurrentMonth(); statsState.year = getCurrentYear(); renderStats(); },
    statsPickMonth: d => { statsState.mode = 'month'; statsState.month = d.value; renderStats(); },
    editBudget: () => openBudgetModal(),
    // Ajustes
    newCategory: () => openCategoryModal(),
    editCategory: d => openCategoryModal(d.value),
    removeCategory: d => removeExpenseCategory(d.value),
    removeAccount: d => removeListItem('accounts', d.value),
    removeIncomeCategory: d => removeListItem('incomeCategories', d.value),
    exportData: () => exportData(),
    exportCsv: () => exportCsv(),
    pickImport: () => $('importFile').click(),
    resetData: () => resetData(),
    dismissBackup: () => { backupBannerDismissed = true; renderBanners(); },
    // Recurrentes
    openRecurring: () => openRecurringModal(),
    addRecurring: d => addRecurring(Number(d.id)),
    addAllRecurring: () => addAllRecurring(),
    skipRecurring: d => skipRecurring(Number(d.id)),
    editRecurringAmount: d => editRecurringAmount(Number(d.id)),
    deleteRecurring: d => deleteRecurring(Number(d.id)),
    // Asistente
    wizBack: () => wizardBack(),
    wizType: d => setWizType(d.value),
    wizKey: d => wizKey(d.value),
    wizAmountNext: () => wizAmountNext(),
    wizGoto: d => wizGoTo(d.value),
    wizCategory: d => { wiz.category = d.value; wizNext(); },
    wizAccount: d => { wiz.account = d.value; wizNext(); },
    wizDate: d => {
        wiz.showOtherDate = d.value === 'other';
        if (d.value === 'today') wiz.date = todayISO();
        if (d.value === 'yesterday') wiz.date = yesterdayISO();
        renderWizDetails();
        if (d.value === 'other') { try { $('wizDateOther').showPicker(); } catch { $('wizDateOther').focus(); } }
    },
    wizDesc: d => { $('wizDescription').value = d.value; }
};

const FORMS = {
    saveTransaction: () => saveTransaction(),
    saveEditedTransaction: () => saveEditedTransaction(),
    saveEditValue: () => saveEditValue(),
    saveCategory: () => saveCategory(),
    confirmReassignCategory: () => confirmReassignCategory(),
    saveBudget: () => saveBudget(),
    addAccount: () => addListItem('accounts', 'newAccountName'),
    addIncomeCategory: () => addListItem('incomeCategories', 'newIncomeCategoryName')
};

// Un solo listener para todos los botones (data-action) y formularios (data-submit)
let pointerDownTarget = null;
document.addEventListener('pointerdown', e => { pointerDownTarget = e.target; });

document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) {
        e.preventDefault();
        ACTIONS[el.dataset.action](el.dataset);
        return;
    }
    // Clic en el fondo oscuro cierra la ventana (pero no si se arrastró desde dentro, p. ej. seleccionando texto)
    if (e.target.classList.contains('modal') && pointerDownTarget === e.target) closeModal(e.target.id);
});

document.addEventListener('submit', e => {
    const handler = FORMS[e.target.dataset.submit];
    if (!handler) return;
    e.preventDefault();
    handler();
});

document.addEventListener('keydown', e => {
    if (isPinScreenActive()) {
        if (/^[0-9]$/.test(e.key)) pinKey(e.key);
        else if (e.key === 'Backspace') pinKey('back');
        return;
    }
    if (e.key === 'Escape') {
        const top = modalStack[modalStack.length - 1];
        if (top) closeModal(top);
        return;
    }
    // Enter/espacio sobre filas pulsables
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action]')) {
        e.preventDefault();
        e.target.click();
        return;
    }
    // Teclado físico en el paso del importe
    if (wiz && modalStack[modalStack.length - 1] === 'addTransactionModal' && wizSteps()[wiz.step] === 'amount') {
        if (/^[0-9]$/.test(e.key)) wizKey(e.key);
        else if (e.key === ',' || e.key === '.') wizKey(',');
        else if (e.key === 'Backspace') wizKey('back');
        else if (e.key === 'Enter') wizAmountNext();
        else return;
        e.preventDefault();
        return;
    }
    // Atajos (solo si no se está escribiendo ni hay ventanas abiertas)
    if (modalStack.length || e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    if (key === 'g') openAddTransaction('expense');
    else if (key === 'i') openAddTransaction('income');
    else if (key === '/') { showSection('inicio'); $('txSearch').focus(); }
    else if (key === '1') showSection('inicio');
    else if (key === '2') showSection('estadisticas');
    else if (key === '3') showSection('ajustes');
    else return;
    e.preventDefault();
});

// Gráficas: al pasar el ratón (o enfocar) un elemento con data-caption, su texto aparece bajo la gráfica
function showCaption(e) {
    const el = e.target.closest?.('[data-caption]');
    const caption = el?.closest('.chart')?.querySelector('.chart-caption');
    if (caption) caption.textContent = el.dataset.caption;
}
function restoreCaption(e) {
    const el = e.target.closest?.('[data-caption]');
    const caption = el?.closest('.chart')?.querySelector('.chart-caption');
    if (caption) caption.textContent = caption.dataset.default || '';
}
document.addEventListener('pointerover', showCaption);
document.addEventListener('pointerout', restoreCaption);
document.addEventListener('focusin', showCaption);
document.addEventListener('focusout', restoreCaption);

// ============================================
// NAVEGACIÓN Y REFRESCO
// ============================================

function showSection(sectionId) {
    currentSection = sectionId;
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === sectionId));
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === sectionId));
    renderSection(sectionId);
    window.scrollTo(0, 0);
}

function renderSection(sectionId) {
    if (sectionId === 'inicio') renderHome();
    else if (sectionId === 'estadisticas') renderStats();
    else if (sectionId === 'ajustes') renderSettings();
}

// Redibuja lo visible tras cualquier cambio en los datos
function refreshAll() {
    updateMonthFilter();
    updateCategoryFilter();
    renderBanners();
    renderSection(currentSection);
}

// ============================================
// AVISOS (backup y recurrentes)
// ============================================

function getPendingRecurring() {
    const month = getCurrentMonth();
    return data.recurring.filter(r => !r.lastMonth || r.lastMonth < month);
}

function renderBanners() {
    let html = '';
    const pending = getPendingRecurring().length;
    if (pending) {
        html += `<div class="banner">
            <span>🔁 ${plural(pending, 'movimiento recurrente pendiente', 'movimientos recurrentes pendientes')} en ${escapeHtml(monthName(getCurrentMonth()))}</span>
            <button class="btn-primary btn-small" data-action="openRecurring">Revisar</button>
        </div>`;
    }
    const needsBackup = data.transactions.length > 0 && (!data.lastBackup || daysSince(data.lastBackup) >= BACKUP_REMINDER_DAYS);
    if (needsBackup && !backupBannerDismissed) {
        html += `<div class="banner warning">
            <span>💾 ${data.lastBackup ? `Tu último backup fue hace ${daysSince(data.lastBackup)} días` : 'Aún no has hecho ningún backup'}</span>
            <span class="button-row">
                <button class="btn-primary btn-small" data-action="exportData">Descargar</button>
                <button class="btn-secondary btn-small" data-action="dismissBackup">Más tarde</button>
            </span>
        </div>`;
    }
    setHtml('banners', html);
}

// ============================================
// INICIO
// ============================================

function kpiHtml({ label, value, sub = '', tone = '', cls = '', action = '', actionValue = '' }) {
    const tag = action ? 'button' : 'div';
    return `<${tag} class="kpi ${cls}"${action ? ` data-action="${action}" data-value="${actionValue}"` : ''}>
        <span class="kpi-label">${label}</span>
        <span class="kpi-value ${tone}">${value}</span>
        <span class="kpi-sub">${sub}</span>
    </${tag}>`;
}

function renderHome() {
    const period = getPeriod('month', getCurrentMonth());
    const cur = summarize(period.filter), prev = summarize(period.prevFilter);
    const patrimony = getPatrimony();
    const perDay = cur.expenses / Math.max(period.daysElapsed, 1);

    setText('homeTitle', period.label);
    setHtml('homeKpis', [
        kpiHtml({
            cls: 'kpi-main', label: 'Gastado este mes', value: formatCurrency(cur.expenses), action: 'nav', actionValue: 'estadisticas',
            sub: deltaBadge(cur.expenses, prev.expenses, period.prevLabel) + `<span class="kpi-extra">${formatRound(perDay)}/día de media</span>`
        }),
        kpiHtml({
            label: 'Ingresos', value: formatCurrency(cur.income), tone: 'pos', action: 'details', actionValue: 'income',
            sub: deltaBadge(cur.income, prev.income, period.prevLabel, false)
        }),
        kpiHtml({
            label: 'Ahorro', value: formatCurrency(cur.saved), tone: cur.saved < 0 ? 'neg' : '', action: 'details', actionValue: 'savings',
            sub: cur.savingsRate === null ? 'Sin ingresos este mes' : `${formatPercent(cur.savingsRate)} de tus ingresos`
        }),
        kpiHtml({
            label: 'Patrimonio', value: formatRound(patrimony.total), action: 'details', actionValue: 'patrimony',
            sub: `Disponible ${formatRound(patrimony.available)}`
        })
    ].join(''));

    renderTransactions();
    renderHomeSide();
}

// Panel lateral (solo ordenador): categorías y reparto del mes elegido en la lista
function renderHomeSide() {
    const month = $('txMonth').value;
    const filter = month ? inMonth(month) : () => true;
    const label = month ? formatMonth(month) : 'todos los meses';
    const ranking = categoryRanking(filter);
    const total = ranking.reduce((s, r) => s + r.total, 0);
    setText('sideCatTitle', `Gastos · ${label}`);
    setHtml('sideCategories', ranking.length ? ranking.slice(0, 7).map(r => `
        <div class="side-rank">
            <span class="rank-name">${escapeHtml(r.category)}</span>
            <span class="rank-amount">${formatCurrency(r.total)}</span>
            <span class="rank-pct">${formatPercent(r.total / total * 100)}</span>
            ${barHtml(r.total / ranking[0].total)}
        </div>`).join('') : emptyHtml('Sin gastos'));
    setText('sideBudgetTitle', `Reparto · ${label}`);
    setHtml('sideBudget', budgetHtml(filter));
}

function resetListAndRender() {
    listState.limit = PAGE_SIZE;
    renderTransactions();
}

const TYPE_CHIPS = [['all', 'Todo'], ['expense', 'Gastos'], ['income', 'Ingresos'], ['investment', 'Inversión']];
const KIND_BADGES = { investment: 'Inversión', adjustment: 'Ajuste' };

function matchesSearch(t, query) {
    return normalizeText([t.category, t.description, t.account, t.amount.toFixed(2).replace('.', ','), t.amount].join(' ')).includes(query);
}

function renderTransactions() {
    const month = $('txMonth').value;
    const query = normalizeText($('txSearch').value.trim());
    const [filterType, filterCat] = ($('txCategoryFilter').value || ':').split(/:(.*)/);
    const { type } = listState;

    const list = data.transactions.filter(t => {
        if (month && t.month !== month) return false;
        const kind = txKind(t);
        if (type === 'expense' ? kind !== 'expense' && kind !== 'adjustment' : type !== 'all' && kind !== type) return false;
        if (filterCat && (t.type !== filterType || t.category !== filterCat)) return false;
        return !query || matchesSearch(t, query);
    }).sort(compareTransactions);

    setHtml('txTypeChips', TYPE_CHIPS.map(([value, label]) =>
        `<button class="chip${value === type ? ' selected' : ''}" data-action="txType" data-value="${value}">${label}</button>`).join(''));

    const ids = new Set(list.map(t => t.id));
    const totals = summarize(t => ids.has(t.id));
    setHtml('txTotals', [
        `<span>${plural(list.length, 'movimiento', 'movimientos')}</span>`,
        totals.income ? `<span class="pos">+${formatCurrency(totals.income)}</span>` : '',
        totals.expenses ? `<span class="neg">−${formatCurrency(totals.expenses)}</span>` : '',
        totals.invested ? `<span>Invertido ${formatCurrency(totals.invested)}</span>` : ''
    ].join(''));

    if (!list.length) {
        setHtml('txList', emptyHtml(data.transactions.length ? 'No hay movimientos con estos filtros' : 'Aún no hay movimientos. Añade el primero con el botón +'));
        return;
    }

    // Agrupados por día, con el gasto de cada día en la cabecera
    let html = '', lastGroup = null;
    const dayTotals = {};
    list.forEach(t => { if (txKind(t) === 'expense') { const k = `${t.month}-${txDay(t)}`; dayTotals[k] = (dayTotals[k] || 0) + t.amount; } });
    list.slice(0, listState.limit).forEach(t => {
        const group = `${t.month}-${txDay(t)}`;
        if (group !== lastGroup) {
            lastGroup = group;
            html += `<div class="tx-day"><span>${escapeHtml(formatTxDate(t, { weekday: true }))}</span><span>${dayTotals[group] ? '−' + formatCurrency(dayTotals[group]) : ''}</span></div>`;
        }
        html += transactionRowHtml(t);
    });
    if (list.length > listState.limit) html += `<button class="btn-secondary full-width tx-more" data-action="txMore">Ver más (${list.length - listState.limit} restantes)</button>`;
    setHtml('txList', html);
}

function transactionRowHtml(t) {
    const kind = txKind(t);
    const sign = kind === 'income' ? '+' : '−';
    return `<div class="tx kind-${kind}" data-action="editTransaction" data-id="${t.id}" role="button" tabindex="0">
        <span class="tx-date">${escapeHtml(formatTxDate(t))}</span>
        <span class="tx-cat">${escapeHtml(t.category)}${KIND_BADGES[kind] ? `<em class="badge">${KIND_BADGES[kind]}</em>` : ''}</span>
        <span class="tx-note">${escapeHtml(t.description || '')}</span>
        <span class="tx-account">${escapeHtml(t.account)}</span>
        <span class="tx-amount">${sign}${formatCurrency(t.amount)}</span>
    </div>`;
}

// Mantiene el mes elegido; al arrancar elige el mes en curso
function updateMonthFilter(selectCurrent = false) {
    const select = $('txMonth');
    const current = getCurrentMonth();
    const months = [...new Set([current, ...data.transactions.map(t => t.month)])].sort().reverse();
    const previous = selectCurrent ? current : select.value;
    select.innerHTML = '<option value="">Todos los meses</option>'
        + months.map(m => `<option value="${m}">${escapeHtml(capitalize(formatMonth(m)))}</option>`).join('');
    select.value = months.includes(previous) ? previous : '';
}

function updateCategoryFilter() {
    const select = $('txCategoryFilter');
    const previous = select.value;
    const option = (type, cat) => `<option value="${type}:${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
    select.innerHTML = '<option value="">Todas las categorías</option>'
        + Object.values(data.categoryGroups).map(g => `<optgroup label="${escapeHtml(g.name)}">${g.categories.map(c => option('expense', c)).join('')}</optgroup>`).join('')
        + `<optgroup label="Ingresos">${data.incomeCategories.map(c => option('income', c)).join('')}</optgroup>`;
    select.value = [...select.options].some(o => o.value === previous) ? previous : '';
}

// ============================================
// NUEVO MOVIMIENTO (asistente: importe → categoría → cuenta → detalles)
// ============================================

function openAddTransaction(type) {
    wiz = {
        type, step: 0, amount: '', category: null, showOtherDate: false,
        account: data.accounts.includes(data.lastAccount) ? data.lastAccount : data.accounts[0],
        date: todayISO()
    };
    $('wizDescription').value = '';
    $('wizRecurring').checked = false;
    renderWizard();
    openModal('addTransactionModal');
}

// Si solo hay una cuenta, ese paso se salta
const wizSteps = () => data.accounts.length > 1 ? ['amount', 'category', 'account', 'details'] : ['amount', 'category', 'details'];
const parseWizAmount = () => parseAmount(wiz.amount.replace(/,$/, '')) || 0;

function setWizType(type) {
    if (wiz.type === type) return;
    wiz.type = type;
    wiz.category = null;
    renderWizard();
}

function wizGoTo(stepName) {
    const i = wizSteps().indexOf(stepName);
    if (i >= 0 && i <= wiz.step) { wiz.step = i; renderWizard(); }
}

function wizNext() {
    wiz.step = Math.min(wiz.step + 1, wizSteps().length - 1);
    renderWizard();
}

function wizardBack() {
    if (wiz && wiz.step > 0) { wiz.step--; renderWizard(); }
}

function renderWizard() {
    const steps = wizSteps();
    const current = steps[wiz.step];
    const isIncomeType = wiz.type === 'income';
    setText('transactionModalTitle', isIncomeType ? 'Nuevo ingreso' : 'Nuevo gasto');
    $('addTransactionModal').classList.toggle('is-income', isIncomeType);
    document.querySelectorAll('#wizType button').forEach(b => b.classList.toggle('selected', b.dataset.value === wiz.type));
    document.querySelectorAll('#addTransactionModal .wizard-step').forEach(el => el.classList.toggle('active', el.dataset.step === current));
    $('wizBack').style.visibility = wiz.step > 0 ? 'visible' : 'hidden';
    setHtml('wizDots', steps.map((_, i) => `<span class="${i < wiz.step ? 'done' : i === wiz.step ? 'current' : ''}"></span>`).join(''));

    // Lo ya elegido, en "chips" pulsables para volver a ese paso
    const chips = [];
    if (wiz.step > 0) chips.push(['amount', formatCurrency(parseWizAmount())]);
    if (wiz.step > steps.indexOf('category')) chips.push(['category', wiz.category]);
    if (steps.includes('account') && wiz.step > steps.indexOf('account')) chips.push(['account', wiz.account]);
    setHtml('wizSummary', chips.map(([step, label]) => `<button type="button" class="chip small" data-action="wizGoto" data-value="${step}">${escapeHtml(label)}</button>`).join(''));

    if (current === 'amount') renderWizAmount();
    else if (current === 'category') renderWizCategories();
    else if (current === 'account') renderWizAccounts();
    else renderWizDetails();
}

function renderWizAmount() {
    const [int, dec] = wiz.amount.split(',');
    const display = $('wizAmountDisplay');
    display.textContent = intFormatter.format(Number(int || 0)) + (dec !== undefined ? ',' + dec : '') + ' €';
    display.classList.toggle('empty', !wiz.amount);
}

function wizKey(key) {
    let a = wiz.amount;
    if (key === 'back') {
        a = a.slice(0, -1);
    } else if (key === ',') {
        if (!a.includes(',')) a = (a || '0') + ',';
    } else {
        const [int, dec] = a.split(',');
        if (dec !== undefined ? dec.length >= 2 : int.length >= 7) return;
        a = a === '0' ? key : a + key;
    }
    wiz.amount = a;
    navigator.vibrate?.(8);
    renderWizAmount();
}

function wizAmountNext() {
    if (parseWizAmount() > 0) { wizNext(); return; }
    const display = $('wizAmountDisplay');
    display.classList.remove('shake');
    void display.offsetWidth; // reinicia la animación
    display.classList.add('shake');
}

// Las categorías más usadas en los últimos 6 meses salen primero
function categoryUsageCounts(type) {
    const since = shiftMonth(getCurrentMonth(), -6);
    const counts = {};
    data.transactions.forEach(t => { if (t.type === type && t.month >= since) counts[t.category] = (counts[t.category] || 0) + 1; });
    return counts;
}

function choiceHtml(action, value, selected, small = '') {
    return `<button type="button" class="choice${selected ? ' selected' : ''}" data-action="${action}" data-value="${escapeHtml(value)}">
        <span>${escapeHtml(value)}</span>${small ? `<small>${escapeHtml(small)}</small>` : ''}
    </button>`;
}

// Gastos normales primero (por uso); las de Inversión aparte, abajo, para no mezclarlas
function renderWizCategories() {
    const counts = categoryUsageCounts(wiz.type);
    const byUsage = list => [...list].sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0));
    const button = c => choiceHtml('wizCategory', c.name, c.name === wiz.category, c.group);

    if (wiz.type === 'income') {
        setHtml('wizCategoryChoices', byUsage(data.incomeCategories.map(name => ({ name }))).map(button).join(''));
        return;
    }
    const { inversion, ...spendingGroups } = data.categoryGroups;
    const spending = Object.values(spendingGroups).flatMap(g => g.categories.map(name => ({ name, group: g.name })));
    setHtml('wizCategoryChoices', byUsage(spending).map(button).join('')
        + (inversion.categories.length ? `<div class="choice-section">${escapeHtml(inversion.name)} · no cuenta como gasto</div>` + inversion.categories.map(name => button({ name })).join('') : ''));
}

function renderWizAccounts() {
    const last = data.lastAccount;
    const accounts = data.accounts.includes(last) ? [last, ...data.accounts.filter(a => a !== last)] : data.accounts;
    setHtml('wizAccountChoices', accounts.map(a => choiceHtml('wizAccount', a, a === wiz.account, a === last ? 'Última usada' : '')).join(''));
}

function renderWizDetails() {
    const today = todayISO(), yesterday = yesterdayISO();
    const isOther = wiz.showOtherDate || (wiz.date !== today && wiz.date !== yesterday);
    const chip = (value, label, selected) => `<button type="button" class="chip${selected ? ' selected' : ''}" data-action="wizDate" data-value="${value}">${label}</button>`;
    setHtml('wizDateChips', chip('today', 'Hoy', !isOther && wiz.date === today)
        + chip('yesterday', 'Ayer', !isOther && wiz.date === yesterday)
        + chip('other', isOther ? escapeHtml(formatDate(wiz.date + 'T12:00')) : 'Otro día', isOther));
    const other = $('wizDateOther');
    other.style.display = isOther ? 'block' : 'none';
    other.value = wiz.date;

    // Notas que ya usaste en esta categoría, para no reescribirlas.
    // Las de ajuste no se sugieren: convertirían el gasto en un ajuste sin querer
    const counts = {};
    data.transactions.forEach(t => {
        const desc = (t.description || '').trim();
        if (t.type === wiz.type && t.category === wiz.category && desc && !isAdjustment(t)) counts[desc] = (counts[desc] || 0) + 1;
    });
    const suggestions = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 6);
    setHtml('wizDescSuggestions', suggestions.map(s => `<button type="button" class="chip small" data-action="wizDesc" data-value="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join(''));

    setText('wizSaveBtn', `Guardar ${formatCurrency(parseWizAmount())}`);
}

// Se asegura de que el movimiento recién guardado se vea en la lista
function revealInList(tx) {
    const select = $('txMonth');
    if (select.value && select.value !== tx.month) select.value = tx.month;
    listState.type = 'all';
    $('txSearch').value = '';
    $('txCategoryFilter').value = '';
    listState.limit = PAGE_SIZE;
}

function undoable(message, undo) {
    showNotification(message, 'success', {
        actionLabel: 'Deshacer',
        duration: UNDO_DURATION,
        onAction: () => { undo(); saveData(); refreshAll(); showNotification('Deshecho', 'success'); }
    });
}

function saveTransaction() {
    if (!wiz) return;
    const amount = parseWizAmount();
    if (!(amount > 0)) { wizGoTo('amount'); return; }
    if (!wiz.category) { wizGoTo('category'); return; }
    if (!wiz.date) { showNotification('Elige una fecha', 'warning'); return; }

    const { type, category, account } = wiz;
    const description = $('wizDescription').value.trim();
    const { month, day } = splitDate(wiz.date);
    const tx = { id: newId(), type, month, day, amount, category, account, description, date: new Date().toISOString() };
    data.transactions.push(tx);
    data.lastAccount = account;
    let recurring = null;
    if ($('wizRecurring').checked) {
        recurring = { id: newId(), type, category, amount, account, description, day, lastMonth: month };
        data.recurring.push(recurring);
    }
    saveData();
    closeModal('addTransactionModal');
    wiz = null;
    updateMonthFilter();
    revealInList(tx);
    refreshAll();

    const kind = txKind(tx);
    const label = { income: 'Ingreso guardado', expense: 'Gasto guardado', investment: 'Inversión guardada (no cuenta como gasto)', adjustment: 'Ajuste de patrimonio guardado (no cuenta como gasto)' }[kind];
    undoable(`${label}: ${category} ${formatCurrency(amount)}`, () => {
        data.transactions = data.transactions.filter(t => t.id !== tx.id);
        if (recurring) data.recurring = data.recurring.filter(r => r.id !== recurring.id);
    });
}

// ============================================
// EDITAR / BORRAR / DUPLICAR
// ============================================

const editedTransaction = () => data.transactions.find(t => t.id === Number($('editTransactionId').value));

function openEditTransaction(id) {
    const t = data.transactions.find(t => t.id === id);
    if (!t) return;
    $('editTransactionId').value = t.id;
    setText('editTransactionTitle', t.type === 'income' ? 'Editar ingreso' : 'Editar gasto');
    $('editAmount').value = amountToInput(t.amount);
    $('editDate').value = `${t.month}-${pad(txDay(t) || 1)}`;
    $('editCategory').innerHTML = categoryOptionsHtml(t.type, t.category);
    $('editAccount').innerHTML = optionsHtml(withCurrent(data.accounts, t.account), t.account);
    $('editDescription').value = t.description || '';
    openModal('editTransactionModal');
}

function saveEditedTransaction() {
    const t = editedTransaction();
    if (!t) return;
    const amount = parseAmount($('editAmount').value);
    const dateValue = $('editDate').value;
    if (!(amount > 0)) { showNotification('Introduce un importe mayor que 0', 'warning'); return; }
    if (!dateValue) { showNotification('Elige una fecha', 'warning'); return; }

    const { month, day } = splitDate(dateValue);
    // Los movimientos antiguos no tenían día: si no se tocó la fecha, se quedan como estaban
    if (month !== t.month || day !== (txDay(t) || 1)) { t.day = day; delete t._day; }
    t.month = month;
    t.amount = amount;
    t.category = $('editCategory').value;
    t.account = $('editAccount').value;
    t.description = $('editDescription').value.trim();

    saveData();
    closeModal('editTransactionModal');
    refreshAll();
    showNotification('Actualizado', 'success');
}

function deleteEditedTransaction() {
    const id = Number($('editTransactionId').value);
    const index = data.transactions.findIndex(t => t.id === id);
    closeModal('editTransactionModal');
    if (index < 0) return;
    const [removed] = data.transactions.splice(index, 1);
    saveData();
    refreshAll();
    undoable(`Eliminado: ${removed.category} ${formatCurrency(removed.amount)}`, () => data.transactions.splice(index, 0, removed));
}

// Copia el movimiento con fecha de hoy (para gastos que se repiten de vez en cuando)
function duplicateTransaction() {
    const t = editedTransaction();
    if (!t) return;
    const { month, day } = splitDate(todayISO());
    const copy = { id: newId(), type: t.type, month, day, amount: t.amount, category: t.category, account: t.account, description: t.description, date: new Date().toISOString() };
    data.transactions.push(copy);
    saveData();
    closeModal('editTransactionModal');
    updateMonthFilter();
    revealInList(copy);
    refreshAll();
    undoable(`Duplicado hoy: ${copy.category} ${formatCurrency(copy.amount)}`, () => { data.transactions = data.transactions.filter(x => x.id !== copy.id); });
}

// ============================================
// MOVIMIENTOS RECURRENTES
// ============================================

const recurringLabel = r => `${r.category}${r.description ? ' · ' + r.description : ''}`;
const recurringMeta = r => `${r.type === 'income' ? 'Ingreso' : 'Gasto'} · ${escapeHtml(r.account)}${r.day ? ' · día ' + r.day : ''}`;

function openRecurringModal() {
    renderRecurringPending();
    if (getPendingRecurring().length) openModal('recurringModal');
}

function renderRecurringPending() {
    const pending = getPendingRecurring();
    setText('recurringModalTitle', `Recurrentes de ${monthName(getCurrentMonth())}`);
    if (!pending.length) { closeModal('recurringModal'); return; }
    setHtml('recurringPendingList', pending.map(r => `
        <div class="recurring-item">
            <div class="recurring-info"><strong>${escapeHtml(recurringLabel(r))}</strong><small>${recurringMeta(r)}</small></div>
            <input type="text" id="rec-amount-${r.id}" value="${amountToInput(r.amount)}" inputmode="decimal" aria-label="Importe">
            <div class="button-row">
                <button class="btn-primary btn-small" data-action="addRecurring" data-id="${r.id}">Añadir</button>
                <button class="btn-secondary btn-small" data-action="skipRecurring" data-id="${r.id}">Omitir</button>
            </div>
        </div>`).join(''));
}

// Devuelve true si se añadió. No guarda ni repinta: lo hace quien llama
function applyRecurring(r) {
    const input = $(`rec-amount-${r.id}`);
    const amount = input ? parseAmount(input.value) : r.amount;
    if (!(amount > 0)) return false;
    const month = getCurrentMonth();
    const day = r.day ? Math.min(r.day, daysInMonth(month)) : new Date().getDate();
    data.transactions.push({ id: newId(), type: r.type, month, day, amount, category: r.category, account: r.account, description: r.description, date: new Date().toISOString() });
    r.lastMonth = month;
    return true;
}

function afterRecurringChange() {
    saveData();
    refreshAll();
    renderRecurringPending();
}

function addRecurring(id) {
    const r = data.recurring.find(r => r.id === id);
    if (!r) return;
    if (!applyRecurring(r)) { showNotification('Importe no válido', 'warning'); return; }
    afterRecurringChange();
    showNotification(`Añadido: ${recurringLabel(r)}`, 'success');
}

function addAllRecurring() {
    const pending = getPendingRecurring();
    const added = pending.filter(applyRecurring).length;
    afterRecurringChange();
    if (added < pending.length) showNotification('Revisa los importes que no son válidos', 'warning');
    else showNotification(plural(added, 'movimiento añadido', 'movimientos añadidos'), 'success');
}

function skipRecurring(id) {
    const r = data.recurring.find(r => r.id === id);
    if (!r) return;
    r.lastMonth = getCurrentMonth();
    afterRecurringChange();
}

function editRecurringAmount(id) {
    const r = data.recurring.find(r => r.id === id);
    if (!r) return;
    openEditModal(`Importe de ${recurringLabel(r)}`, r.amount, value => {
        if (!(value > 0)) return 'Introduce un importe mayor que 0';
        r.amount = value;
        saveData();
        refreshAll();
        showNotification('Recurrente actualizado', 'success');
    });
}

function deleteRecurring(id) {
    const index = data.recurring.findIndex(r => r.id === id);
    if (index < 0) return;
    const [removed] = data.recurring.splice(index, 1);
    saveData();
    refreshAll();
    undoable('Recurrente eliminado', () => data.recurring.splice(index, 0, removed));
}

// ============================================
// ESTADÍSTICAS
// ============================================

function shiftStatsPeriod(delta) {
    if (statsState.mode === 'year') statsState.year += delta;
    else statsState.month = shiftMonth(statsState.month, delta);
    renderStats();
}

function renderStats() {
    const period = getPeriod(statsState.mode, statsState.month, statsState.year);
    const cur = summarize(period.filter), prev = summarize(period.prevFilter);

    document.querySelectorAll('#statsMode button').forEach(b => b.classList.toggle('selected', b.dataset.value === period.mode));
    setText('statsPeriodLabel', period.mode === 'month' && !DESKTOP.matches ? capitalize(shortMonthName(period.month)) + ' ' + period.month.slice(0, 4) : period.label);
    $('statsToday').style.visibility = period.isCurrent ? 'hidden' : 'visible';

    renderStatsKpis(period, cur, prev);
    renderStatsCategories(period, cur);
    renderPace(period);
    renderEvolution(period);
    setText('budgetTitle', 'Reparto ' + Object.values(data.categoryGroups).map(g => g.percent).join('/'));
    setHtml('statsBudget', budgetHtml(period.filter));
    renderTopExpenses(period);
    renderAccounts(period, cur);
    renderWeekdays(period);
}

function renderStatsKpis(period, cur, prev) {
    const perDay = cur.expenses / Math.max(period.daysElapsed, 1);
    const projection = perDay * period.daysTotal;
    const showProjection = period.isCurrent && period.daysElapsed >= 3 && period.daysElapsed < period.daysTotal;
    setHtml('statsKpis', [
        kpiHtml({ cls: 'kpi-main', label: 'Gastado', value: formatCurrency(cur.expenses), sub: deltaBadge(cur.expenses, prev.expenses, period.prevLabel) || plural(cur.count, 'gasto', 'gastos') }),
        kpiHtml({ label: 'Ingresos', value: formatCurrency(cur.income), tone: 'pos', sub: deltaBadge(cur.income, prev.income, period.prevLabel, false) }),
        kpiHtml({
            label: 'Ahorrado', value: formatCurrency(cur.saved), tone: cur.saved < 0 ? 'neg' : '',
            sub: cur.savingsRate === null ? 'Sin ingresos' : `${formatPercent(cur.savingsRate)} de los ingresos` + (cur.invested ? ` · invertido ${formatRound(cur.invested)}` : '')
        }),
        kpiHtml({
            label: 'Media diaria', value: formatCurrency(perDay),
            sub: showProjection ? `A este ritmo: ${formatRound(projection)} a fin de ${period.mode === 'year' ? 'año' : 'mes'}` : plural(cur.count, 'gasto', 'gastos')
        })
    ].join(''));
}

// Ranking de categorías: barra proporcional, importe, % del total y cambio respecto al periodo anterior
function renderStatsCategories(period, cur) {
    const ranking = categoryRanking(period.filter, period.prevFilter);
    if (!ranking.length) { setHtml('statsCategories', emptyHtml('Sin gastos en este periodo')); return; }
    const max = ranking[0].total;
    setHtml('statsCategories', ranking.map(r => `
        <details class="rank">
            <summary>
                <span class="rank-name">${escapeHtml(r.category)}</span>
                <span class="rank-meta">${plural(r.txs.length, 'gasto', 'gastos')} · media ${formatCurrency(r.total / r.txs.length)}</span>
                <span class="rank-delta">${deltaBadge(r.total, r.prev, '')}</span>
                <span class="rank-amount">${formatCurrency(r.total)}</span>
                <span class="rank-pct">${formatPercent(r.total / cur.expenses * 100)}</span>
                ${barHtml(r.total / max)}
            </summary>
            <div class="rank-detail">
                ${[...r.txs].sort((a, b) => b.amount - a.amount).slice(0, 40).map(t => miniTxHtml(t)).join('')}
                ${r.txs.length > 40 ? `<p class="hint">…y ${r.txs.length - 40} más pequeños</p>` : ''}
            </div>
        </details>`).join('')
        + `<p class="hint rank-foot">Las flechas comparan con ${escapeHtml(period.prevLabel)}</p>`);
}

function gridHtml(max) {
    return `<div class="chart-grid" aria-hidden="true">
        <span style="bottom:100%">${formatRound(max)}</span><span style="bottom:50%">${formatRound(max / 2)}</span><span style="bottom:0">0</span>
    </div>`;
}

// Gasto acumulado día a día de un mes: [0, día 1, día 2, ...]
function cumulativeByDay(month) {
    const days = new Array(daysInMonth(month) + 1).fill(0);
    txWhere(isRealExpense, inMonth(month)).forEach(t => { days[Math.min(txDay(t) || 1, days.length - 1)] += t.amount; });
    for (let i = 1; i < days.length; i++) days[i] += days[i - 1];
    return days;
}

// Línea de gasto acumulado del mes frente al mes anterior
function renderPace(period) {
    $('paceCard').style.display = period.mode === 'month' ? '' : 'none';
    if (period.mode !== 'month') return;
    const cur = cumulativeByDay(period.month), prev = cumulativeByDay(period.prevMonth);
    const lastDay = period.daysElapsed;
    const span = Math.max(cur.length, prev.length) - 2; // días − 1
    const max = niceMax(Math.max(cur[lastDay] || 0, prev[prev.length - 1]));
    if (!cur[cur.length - 1] && !prev[prev.length - 1]) { setHtml('statsPace', emptyHtml('Sin gastos en este mes ni en el anterior')); return; }

    const x = day => ((day - 1) / span) * 300;
    const points = (series, until) => series.slice(1, until + 1).map((v, i) => `${x(i + 1).toFixed(1)},${(100 - (v / max) * 100).toFixed(1)}`).join(' ');
    const curName = monthName(period.month), prevName = monthName(period.prevMonth);
    const captionFor = day => {
        const parts = [`Día ${day}`];
        if (day <= lastDay) parts.push(`${curName}: ${formatCurrency(cur[day])}`);
        if (day < prev.length) parts.push(`${prevName}: ${formatCurrency(prev[day])}`);
        return parts.join(' · ');
    };
    const defaultDay = Math.max(lastDay, 1);
    const diff = (cur[lastDay] || 0) - prev[Math.min(defaultDay, prev.length - 1)];
    const summary = lastDay && prev[prev.length - 1]
        ? (period.isCurrent ? `A día ${lastDay} llevas ${formatCurrency(cur[lastDay])}` : `En ${curName} gastaste ${formatCurrency(cur[lastDay])}`) + `: ${formatCurrency(Math.abs(diff))} ${diff > 0 ? 'más' : 'menos'} que en ${prevName}${period.isCurrent ? ' a estas alturas' : ''}.`
        : captionFor(defaultDay);

    setHtml('statsPace', `<div class="chart">
        <div class="legend"><span><i class="swatch line cur"></i>${escapeHtml(curName)}</span><span><i class="swatch line prev"></i>${escapeHtml(prevName)}</span></div>
        <div class="plot pace" id="pacePlot">
            ${gridHtml(max)}
            <svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="Gasto acumulado de ${escapeHtml(curName)} frente a ${escapeHtml(prevName)}">
                <polyline class="prev" points="${points(prev, prev.length - 1)}"/>
                <polyline class="cur" points="${points(cur, lastDay)}"/>
            </svg>
            <i class="pace-cursor" id="paceCursor"></i>
        </div>
        <div class="pace-axis" aria-hidden="true">${[1, 8, 15, 22, 29].map(d => `<span style="left:${(x(d) / 300) * 100}%">${d}</span>`).join('')}</div>
        <p class="chart-caption" data-default="${escapeHtml(summary)}">${escapeHtml(summary)}</p>
    </div>`);

    // Al mover el ratón o el dedo por la gráfica se ve el acumulado de ese día
    const plot = $('pacePlot'), cursor = $('paceCursor'), caption = plot.parentElement.querySelector('.chart-caption');
    const move = e => {
        const rect = plot.getBoundingClientRect();
        const day = Math.max(1, Math.min(span + 1, Math.round(((e.clientX - rect.left) / rect.width) * span) + 1));
        cursor.style.left = (x(day) / 300) * 100 + '%';
        cursor.classList.add('show');
        caption.textContent = captionFor(day);
    };
    plot.addEventListener('pointermove', move);
    plot.addEventListener('pointerdown', move);
    plot.addEventListener('pointerleave', () => { cursor.classList.remove('show'); caption.textContent = summary; });
}

// Barras de ingresos y gastos por mes. Pulsar un mes lo abre
function renderEvolution(period) {
    let months;
    if (period.mode === 'year') {
        months = Array.from({ length: 12 }, (_, i) => `${statsState.year}-${pad(i + 1)}`);
    } else {
        const count = DESKTOP.matches ? 12 : 6;
        const current = getCurrentMonth();
        // La ventana termina en el mes actual salvo que se esté mirando uno que quede fuera
        const end = period.month > current || period.month <= shiftMonth(current, -count) ? period.month : current;
        months = Array.from({ length: count }, (_, i) => shiftMonth(end, i - count + 1));
    }
    const totals = {};
    months.forEach(m => { totals[m] = { income: 0, expenses: 0 }; });
    data.transactions.forEach(t => {
        const m = totals[t.month];
        if (!m) return;
        const kind = txKind(t);
        if (kind === 'income') m.income += t.amount;
        else if (kind === 'expense') m.expenses += t.amount;
    });
    const max = niceMax(Math.max(...months.map(m => Math.max(totals[m].income, totals[m].expenses))));
    const captionFor = m => `${capitalize(formatMonth(m))} · Ingresos ${formatCurrency(totals[m].income)} · Gastos ${formatCurrency(totals[m].expenses)} · Ahorro ${formatCurrency(totals[m].income - totals[m].expenses)}`;
    const defaultCaption = period.mode === 'month' && totals[period.month] ? captionFor(period.month) : 'Pulsa un mes para verlo en detalle';

    setHtml('statsEvolution', `<div class="chart">
        <div class="legend"><span><i class="swatch income"></i>Ingresos</span><span><i class="swatch expense"></i>Gastos</span></div>
        <div class="plot evo">
            ${gridHtml(max)}
            <div class="evo-cols">${months.map(m => `
                <button class="evo-col${period.mode === 'month' && m === period.month ? ' selected' : ''}" data-action="statsPickMonth" data-value="${m}" data-caption="${escapeHtml(captionFor(m))}" aria-label="${escapeHtml(captionFor(m))}">
                    <span class="evo-bars"><i class="income" style="height:${(totals[m].income / max) * 100}%"></i><i class="expense" style="height:${(totals[m].expenses / max) * 100}%"></i></span>
                    <span class="evo-label">${escapeHtml(shortMonthName(m))}${m.endsWith('-01') && period.mode === 'month' ? ' ' + m.slice(2, 4) : ''}</span>
                </button>`).join('')}
            </div>
        </div>
        <p class="chart-caption" data-default="${escapeHtml(defaultCaption)}">${escapeHtml(defaultCaption)}</p>
    </div>`);
}

// Reparto de los ingresos por grupos (p. ej. 15/15/70): cuánto llevas de cada parte
function budgetHtml(filter) {
    const income = sumAmounts(txWhere(isIncome, filter));
    const spentByCategory = sumBy(txWhere(t => t.type === 'expense' && !isAdjustment(t), filter), t => t.category);
    if (!income) return emptyHtml('Sin ingresos en este periodo: no hay nada que repartir');
    return Object.entries(data.categoryGroups).map(([key, group]) => {
        const target = income * (group.percent / 100);
        const spent = group.categories.reduce((s, c) => s + (spentByCategory[c] || 0), 0);
        const diff = target - spent;
        const isGoal = key === 'inversion'; // aquí llegar al objetivo es bueno
        const ok = isGoal ? diff <= 0.005 : diff >= -0.005;
        const status = isGoal
            ? (ok ? `✓ Objetivo cumplido` : `Faltan ${formatCurrency(diff)}`)
            : (ok ? `✓ Quedan ${formatCurrency(diff)}` : `⚠ Pasado ${formatCurrency(-diff)}`);
        return `<div class="budget">
            <div class="budget-head"><span>${escapeHtml(group.name)} <small>${group.percent}%</small></span><span>${formatCurrency(spent)} <small>de ${formatCurrency(target)}</small></span></div>
            ${barHtml(target > 0 ? spent / target : 0, isGoal ? (ok ? 'good' : '') : (ok ? 'good' : 'over'))}
            <div class="budget-status ${ok ? 'good' : isGoal ? '' : 'bad'}">${status}</div>
        </div>`;
    }).join('');
}

function renderTopExpenses(period) {
    const top = txWhere(isRealExpense, period.filter).sort((a, b) => b.amount - a.amount).slice(0, DESKTOP.matches ? 8 : 5);
    setHtml('statsTop', top.length ? top.map(t => miniTxHtml(t, { showCategory: true })).join('') : emptyHtml('Sin gastos'));
}

function renderAccounts(period, cur) {
    const totals = Object.entries(sumBy(txWhere(isRealExpense, period.filter), t => t.account)).sort((a, b) => b[1] - a[1]);
    setHtml('statsAccounts', totals.length ? totals.map(([account, total]) => `
        <div class="side-rank">
            <span class="rank-name">${escapeHtml(account)}</span>
            <span class="rank-amount">${formatCurrency(total)}</span>
            <span class="rank-pct">${formatPercent(total / cur.expenses * 100)}</span>
            ${barHtml(total / totals[0][1])}
        </div>`).join('') : emptyHtml('Sin gastos'));
}

function renderWeekdays(period) {
    const totals = new Array(7).fill(0);
    txWhere(isRealExpense, period.filter).forEach(t => {
        const day = txDay(t);
        if (day) totals[(monthDate(t.month, day).getDay() + 6) % 7] += t.amount; // lunes = 0
    });
    const max = Math.max(...totals);
    if (!max) { setHtml('statsWeekdays', emptyHtml('Sin gastos con fecha')); return; }
    const top = totals.indexOf(max);
    const summary = `Gastas más los ${WEEKDAY_NAMES[top].toLowerCase()}: ${formatCurrency(max)}`;
    setHtml('statsWeekdays', `<div class="chart">
        <div class="plot weekdays">${totals.map((v, i) => `
            <span class="evo-col${i === top ? ' selected' : ''}" tabindex="0" data-caption="${WEEKDAY_NAMES[i]}: ${formatCurrency(v)}">
                <span class="evo-bars"><i class="single" style="height:${(v / max) * 100}%"></i></span>
                <span class="evo-label">${WEEKDAYS[i]}</span>
            </span>`).join('')}
        </div>
        <p class="chart-caption" data-default="${escapeHtml(summary)}">${escapeHtml(summary)}</p>
    </div>`);
}

// --- Reparto (%) ---
function openBudgetModal() {
    setHtml('budgetConfigList', Object.entries(data.categoryGroups).map(([key, group]) =>
        `<div class="form-group"><label for="budget-${key}">${escapeHtml(group.name)} (%)</label><input type="number" id="budget-${key}" value="${group.percent}" min="0" max="100" step="1" inputmode="numeric"></div>`
    ).join(''));
    openModal('budgetModal');
}

function saveBudget() {
    const values = Object.keys(data.categoryGroups).map(key => [key, Math.round(Number($('budget-' + key).value)) || 0]);
    const total = values.reduce((s, [, v]) => s + v, 0);
    // Se valida antes de tocar los datos para no dejar porcentajes a medias
    if (total !== 100 || values.some(([, v]) => v < 0)) { showNotification(`Suman ${total}%, deben sumar 100%`, 'warning'); return; }
    values.forEach(([key, v]) => { data.categoryGroups[key].percent = v; });
    saveData();
    closeModal('budgetModal');
    refreshAll();
    showNotification('Reparto guardado', 'success');
}

// ============================================
// VENTANA DE DETALLES (ingresos, ahorro, patrimonio)
// ============================================

function showDetailsPopup(type) {
    const period = getPeriod('month', getCurrentMonth());
    const cur = summarize(period.filter);
    const prevFull = summarize(inMonth(period.prevMonth));
    const year = getCurrentYear();
    const yearly = summarize(inYear(year));
    const row = (label, value, cls = '') => `<div class="detail-row"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
    let title = '', html = '';

    if (type === 'income') {
        title = 'Ingresos';
        const byCat = Object.entries(sumBy(txWhere(isIncome, period.filter), t => t.category)).sort((a, b) => b[1] - a[1]);
        html = `<div class="detail-hero pos">${formatCurrency(cur.income)}</div>
            <p class="hint center">${escapeHtml(period.label)}</p>
            ${byCat.map(([cat, total]) => row(escapeHtml(cat), formatCurrency(total))).join('')}
            <hr>
            ${row(capitalize(monthName(period.prevMonth)), formatCurrency(prevFull.income))}
            ${row(`Año ${year}`, formatCurrency(yearly.income))}`;
    } else if (type === 'savings') {
        title = 'Ahorro';
        const all = summarize();
        html = `<div class="detail-hero ${cur.saved < 0 ? 'neg' : ''}">${formatCurrency(cur.saved)}</div>
            <p class="hint center">${cur.savingsRate === null ? 'Sin ingresos este mes' : `De cada 100 € que entran este mes, te quedas ${cur.savingsRate.toFixed(0)} €`}</p>
            ${row('Ingresos', formatCurrency(cur.income), 'pos')}
            ${row('Gastos', '−' + formatCurrency(cur.expenses), 'neg')}
            ${cur.invested ? row('De lo ahorrado, invertido', formatCurrency(cur.invested)) : ''}
            <hr>
            ${row(capitalize(monthName(period.prevMonth)), `${formatCurrency(prevFull.saved)} · ${formatPercent(prevFull.savingsRate)}`)}
            ${row(`Año ${year}`, `${formatCurrency(yearly.saved)} · ${formatPercent(yearly.savingsRate)}`)}
            ${row('Histórico', `${formatCurrency(all.saved)} · ${formatPercent(all.savingsRate)}`)}`;
    } else {
        title = 'Patrimonio';
        const p = getPatrimony();
        html = `<div class="detail-hero">${formatCurrency(p.total)}</div>
            <p class="hint center">Todo lo ingresado menos todo lo gastado</p>
            ${row('Disponible', formatCurrency(p.available), p.available < 0 ? 'neg' : '')}
            ${barHtml(p.total > 0 ? p.available / p.total : 0)}
            ${row('Invertido (aportado)', formatCurrency(p.invested))}
            ${barHtml(p.total > 0 ? p.invested / p.total : 0)}`;
    }
    setText('detailsTitle', title);
    setHtml('detailsContent', html);
    openModal('detailsModal');
}

// ============================================
// AJUSTES
// ============================================

function renderSettings() {
    setText('lastBackupText', data.lastBackup
        ? `Último backup: ${formatDate(data.lastBackup)} (hace ${daysSince(data.lastBackup)} días). Tus datos solo están en este dispositivo.`
        : 'Aún no has hecho ningún backup. Tus datos solo están en este dispositivo.');

    const tag = (value, removeAction, editAction) => `<span class="tag">
        ${editAction ? `<button class="tag-name" data-action="${editAction}" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>` : escapeHtml(value)}
        <button class="tag-remove" data-action="${removeAction}" data-value="${escapeHtml(value)}" aria-label="Eliminar ${escapeHtml(value)}">×</button>
    </span>`;
    setHtml('accountsList', data.accounts.map(a => tag(a, 'removeAccount')).join(''));
    setHtml('incomeCategoriesList', data.incomeCategories.map(c => tag(c, 'removeIncomeCategory')).join(''));
    setHtml('expenseCategoriesList', Object.values(data.categoryGroups).map(group => `
        <div class="category-group">
            <div class="category-group-head"><span>${escapeHtml(group.name)}</span><small>${group.percent}% de los ingresos</small></div>
            <div class="tags">${group.categories.map(c => tag(c, 'removeCategory', 'editCategory')).join('') || '<small class="hint">Sin categorías</small>'}</div>
        </div>`).join(''));

    setHtml('recurringSettingsList', data.recurring.length ? data.recurring.map(r => `
        <div class="recurring-item">
            <div class="recurring-info"><strong>${escapeHtml(recurringLabel(r))}</strong><small>${formatCurrency(r.amount)} · ${recurringMeta(r)}</small></div>
            <div class="button-row">
                <button class="btn-secondary btn-small" data-action="editRecurringAmount" data-id="${r.id}">Importe</button>
                <button class="btn-danger btn-small" data-action="deleteRecurring" data-id="${r.id}">Eliminar</button>
            </div>
        </div>`).join('') : emptyHtml('No tienes movimientos recurrentes'));
}

function addListItem(listKey, inputId) {
    const input = $(inputId);
    const value = input.value.trim();
    if (!value) return;
    if (data[listKey].some(v => normalizeText(v) === normalizeText(value))) { showNotification('Ya existe', 'warning'); return; }
    data[listKey].push(value);
    input.value = '';
    saveData();
    refreshAll();
}

// Los movimientos que ya usan ese valor lo conservan
function removeListItem(listKey, value) {
    if (data[listKey].length <= 1) { showNotification('Debe quedar al menos una', 'warning'); return; }
    if (!confirm(`¿Quitar "${value}" de la lista? Los movimientos que ya lo usan no cambian.`)) return;
    data[listKey] = data[listKey].filter(v => v !== value);
    saveData();
    refreshAll();
}

// --- Categorías de gasto ---

// Sin argumento: nueva categoría. Con nombre: renombrar / mover de grupo
function openCategoryModal(category = '') {
    const groupKey = category ? findCategoryGroup(category) : 'ocio';
    setText('categoryModalTitle', category ? 'Editar categoría' : 'Nueva categoría');
    $('categoryOriginal').value = category;
    $('categoryName').value = category;
    $('categoryGroup').innerHTML = Object.entries(data.categoryGroups)
        .map(([key, g]) => `<option value="${key}"${key === groupKey ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
    openModal('categoryModal', category ? null : 'categoryName');
}

function saveCategory() {
    const name = $('categoryName').value.trim();
    const groupKey = $('categoryGroup').value;
    const original = $('categoryOriginal').value;
    if (!name) { showNotification('Escribe un nombre', 'warning'); return; }
    if (name !== original && getAllCategories().some(c => normalizeText(c) === normalizeText(name) && c !== original)) { showNotification('Ya existe una categoría con ese nombre', 'warning'); return; }

    if (original) {
        const oldKey = findCategoryGroup(original);
        if (!oldKey) return;
        const oldList = data.categoryGroups[oldKey].categories;
        const index = oldList.indexOf(original);
        if (oldKey === groupKey) oldList[index] = name;
        else { oldList.splice(index, 1); data.categoryGroups[groupKey].categories.push(name); }
        if (name !== original) renameExpenseCategory(original, name);
    } else {
        data.categoryGroups[groupKey].categories.push(name);
    }
    saveData();
    closeModal('categoryModal');
    refreshAll();
    showNotification(original ? 'Categoría actualizada' : 'Categoría añadida', 'success');
}

// Cambia la categoría en todos los gastos y recurrentes
function renameExpenseCategory(from, to) {
    [...data.transactions, ...data.recurring].forEach(item => { if (item.type === 'expense' && item.category === from) item.category = to; });
}

function removeCategoryFromGroup(category) {
    const list = data.categoryGroups[findCategoryGroup(category)].categories;
    list.splice(list.indexOf(category), 1);
}

function removeExpenseCategory(category) {
    if (!findCategoryGroup(category)) return;
    const used = [...data.transactions, ...data.recurring].filter(item => item.type === 'expense' && item.category === category).length;
    if (!used) {
        if (!confirm(`¿Eliminar "${category}"?`)) return;
        removeCategoryFromGroup(category);
        saveData();
        refreshAll();
        showNotification('Categoría eliminada', 'success');
        return;
    }
    // En uso: hay que mover sus movimientos a otra categoría para no perderlos
    $('reassignFrom').value = category;
    setText('reassignText', `"${category}" tiene ${plural(used, 'movimiento', 'movimientos')}. Elige a qué categoría moverlos para no perderlos de las estadísticas.`);
    $('reassignTo').innerHTML = categoryOptionsHtml('expense', null, category);
    openModal('reassignCategoryModal');
}

function confirmReassignCategory() {
    const from = $('reassignFrom').value;
    const to = $('reassignTo').value;
    if (!to || !findCategoryGroup(from)) return;
    renameExpenseCategory(from, to);
    removeCategoryFromGroup(from);
    saveData();
    closeModal('reassignCategoryModal');
    refreshAll();
    showNotification(`"${from}" eliminada, movimientos movidos a "${to}"`, 'success');
}

// ============================================
// EXPORTAR / IMPORTAR / BORRAR
// ============================================

function downloadFile(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportData() {
    data.lastBackup = new Date().toISOString();
    saveData();
    downloadFile(JSON.stringify(data, null, 2), `finanzas_backup_${todayISO()}.json`, 'application/json');
    backupBannerDismissed = false;
    renderBanners();
    if (currentSection === 'ajustes') renderSettings();
    showNotification('Backup descargado', 'success');
}

// Para abrir en Excel / Google Sheets
function exportCsv() {
    const kinds = { income: 'Ingreso', expense: 'Gasto', investment: 'Inversión', adjustment: 'Ajuste' };
    // Comillas para los separadores y apóstrofo ante fórmulas (=, +, -, @) por seguridad al abrirlo
    const cell = v => { const s = String(v ?? ''); return `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
    const rows = [...data.transactions].sort(compareTransactions).map(t =>
        [`${t.month}-${pad(txDay(t) || 1)}`, kinds[txKind(t)], t.category, t.account, t.description, amountToInput(t.amount.toFixed(2))].map(cell).join(';'));
    downloadFile('﻿' + ['Fecha;Tipo;Categoría;Cuenta;Nota;Importe', ...rows].join('\r\n'), `finanzas_${todayISO()}.csv`, 'text/csv;charset=utf-8');
    showNotification('CSV descargado', 'success');
}

async function importData() {
    const input = $('importFile');
    const file = input.files[0];
    input.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    try {
        const imported = JSON.parse(await file.text());
        if (!imported || !Array.isArray(imported.transactions)) throw new Error('no es un backup de esta app');
        if (!confirm(`¿Reemplazar tus datos actuales por este backup (${imported.transactions.length} movimientos)?`)) return;
        data = normalizeData(imported).normalized;
        if (saveData()) location.reload();
    } catch (err) {
        showNotification('No se pudo cargar: ' + (err instanceof SyntaxError ? 'el archivo no es un JSON válido' : err.message), 'error', { duration: 6000 });
    }
}

function resetData() {
    if (prompt('Esto borra TODO. Haz un backup antes.\nEscribe "BORRAR TODO" para confirmar:') === 'BORRAR TODO') {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}

// ============================================
// VENTANAS Y NOTIFICACIONES
// ============================================

// Botón "Atrás" del móvil: cierra la ventana abierta (o vuelve un paso en el asistente)
// en vez de salir de la app. Se usa una sola entrada de historial mientras haya ventanas abiertas.
const modalStack = [];
let modalHistoryEntry = false;
let ignoredPops = 0;

function pushModalHistory() {
    if (modalHistoryEntry) return;
    history.pushState({ modal: true }, '');
    modalHistoryEntry = true;
}

window.addEventListener('popstate', () => {
    if (ignoredPops) { ignoredPops--; return; }
    modalHistoryEntry = false;
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    if (top === 'addTransactionModal' && wiz && wiz.step > 0) wizardBack();
    else closeModal(top, { fromHistory: true });
    if (modalStack.length) pushModalHistory();
});

function openModal(id, focusId) {
    const el = $(id);
    if (!el.classList.contains('active')) {
        el.classList.add('active');
        modalStack.push(id);
    }
    document.body.classList.add('modal-open');
    pushModalHistory();
    if (focusId) setTimeout(() => $(focusId)?.focus(), 50);
}

function closeModal(id, { fromHistory = false } = {}) {
    const el = $(id);
    if (!el || !el.classList.contains('active')) return;
    el.classList.remove('active');
    const i = modalStack.lastIndexOf(id);
    if (i >= 0) modalStack.splice(i, 1);
    if (id === 'addTransactionModal') wiz = null;
    if (modalStack.length) return;
    document.body.classList.remove('modal-open');
    // Se espera un instante por si se abre otra ventana justo después (no tocar el historial)
    if (!fromHistory) setTimeout(() => {
        if (!modalStack.length && modalHistoryEntry) {
            modalHistoryEntry = false;
            ignoredPops++;
            history.back();
        }
    }, 0);
}

// callback(valor) puede devolver un texto de error para no cerrar la ventana
function openEditModal(title, currentValue, callback) {
    setText('editValueTitle', title);
    $('editValueInput').value = amountToInput(currentValue);
    editValueCallback = callback;
    openModal('editValueModal', 'editValueInput');
}

function saveEditValue() {
    if (!editValueCallback) return;
    const value = parseAmount($('editValueInput').value);
    if (value === null) { showNotification('Introduce un número válido', 'warning'); return; }
    const error = editValueCallback(value);
    if (error) { showNotification(error, 'warning'); return; }
    editValueCallback = null;
    closeModal('editValueModal');
}

let notificationTimer = null;
function showNotification(message, type = 'info', { actionLabel, onAction, duration = 3000 } = {}) {
    document.querySelector('.notification')?.remove();
    clearTimeout(notificationTimer);
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.setAttribute('role', 'status');

    const text = document.createElement('span');
    text.textContent = message;
    n.append(text);

    if (actionLabel && onAction) {
        const action = document.createElement('button');
        action.className = 'notification-action';
        action.textContent = actionLabel;
        action.onclick = () => { n.remove(); onAction(); };
        n.append(action);
    }

    const close = document.createElement('button');
    close.className = 'notification-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Cerrar');
    close.onclick = () => n.remove();
    n.append(close);

    document.body.appendChild(n);
    notificationTimer = setTimeout(() => n.remove(), duration);
}
