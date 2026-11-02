// ============================================
// CONFIGURACIÓN DEL PIN
// ============================================
// ⚠️ PARA CAMBIAR TU PIN, MODIFICA EL VALOR ENTRE COMILLAS AQUÍ:
const PIN_CODE = '123654';
// ⚠️ Debe ser exactamente 6 dígitos
// ============================================

const STORAGE_KEY = 'financeManagerData';
const BACKUP_REMINDER_DAYS = 30;
const UNDO_DURATION = 5000;
const CHART_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js';

const DEFAULT_GROUPS = {
    basicos: { name: 'Gastos Básicos', percent: 20, categories: ['Salud', 'Transporte'] },
    ocio: { name: 'Ocio', percent: 15, categories: ['Comida', 'Hobby', 'Suscripciones', 'Ocio', 'Otros'] },
    inversion: { name: 'Inversión', percent: 65, categories: ['Colchón', 'ETFs', 'Acciones', 'Fondos'] }
};
const DEFAULT_ACCOUNTS = ['Efectivo', 'Cuenta Corriente'];
const DEFAULT_INCOME_CATEGORIES = ['Salario', 'Servicio', 'Otros'];

const BUBBLE_COLORS = ['#4a5c4a', '#6b8e6b', '#8fb88f', '#3a4a3a', '#5a6c5a', '#7a9e7a', '#4a90a4'];
const CHART_COLORS = ['#E74C3C', '#3498DB', '#F1C40F', '#2ECC71', '#9B59B6', '#E67E22', '#8B4513', '#1ABC9C', '#E91E63', '#FF5722', '#607D8B', '#CDDC39', '#00BCD4', '#795548'];

// ============================================
// ESTADO
// ============================================

let data = createDefaultData();
let currentPin = '';
let currentSection = 'dashboard';
let evolutionChart = null, distributionChart = null;
let chartState = { isYearly: false, currentMonth: null, currentYear: null };
let distributionState = { currentMonth: null };
let editValueCallback = null;
let backupBannerDismissed = false;
let pendingStartupMessage = null;
let lastId = 0;

function createDefaultData() {
    return {
        setupComplete: false,
        emergencyGoal: 5000,
        categoryGroups: JSON.parse(JSON.stringify(DEFAULT_GROUPS)),
        accounts: [...DEFAULT_ACCOUNTS],
        incomeCategories: [...DEFAULT_INCOME_CATEGORIES],
        recurring: [],
        investmentValues: {},
        lastAccount: null,
        lastBackup: null,
        transactions: []
    };
}

// ============================================
// SISTEMA DE PIN
// ============================================

function isPinScreenActive() {
    return document.getElementById('pinScreen').classList.contains('active');
}

function addPinDigit(digit) {
    if (currentPin.length >= 6) return;
    currentPin += digit;
    hidePinError();
    updatePinDots();
    if (currentPin.length === 6) setTimeout(checkPin, 200);
}

function deletePinDigit() {
    if (!currentPin.length) return;
    currentPin = currentPin.slice(0, -1);
    updatePinDots();
    hidePinError();
}

function updatePinDots() {
    document.querySelectorAll('.pin-dot').forEach((dot, i) => dot.classList.toggle('filled', i < currentPin.length));
}

function checkPin() {
    if (currentPin === PIN_CODE) {
        unlockApp();
    } else {
        document.getElementById('pinError').classList.add('show');
        currentPin = '';
        updatePinDots();
    }
}

function hidePinError() {
    document.getElementById('pinError').classList.remove('show');
}

function unlockApp() {
    document.getElementById('pinScreen').classList.remove('active');
    document.getElementById('appContainer').classList.add('unlocked');
    refreshAll();
    if (pendingStartupMessage) {
        showNotification(pendingStartupMessage, 'info', { duration: 8000 });
        pendingStartupMessage = null;
    }
}

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    const currentMonth = getCurrentMonth();
    chartState.currentMonth = currentMonth;
    chartState.currentYear = getCurrentYear();
    distributionState.currentMonth = currentMonth;

    updateMonthFilters(true);
    showSection(data.setupComplete ? 'dashboard' : 'inversiones');
    registerServiceWorker();
});

function registerServiceWorker() {
    // Solo funciona servido por http(s), no abriendo el archivo directamente (file://)
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('Service worker no registrado:', err));
}

// Atajos de teclado: PIN con teclado físico y Esc para cerrar ventanas
document.addEventListener('keydown', e => {
    if (isPinScreenActive()) {
        if (/^[0-9]$/.test(e.key)) addPinDigit(e.key);
        else if (e.key === 'Backspace') deletePinDigit();
        return;
    }
    if (e.key === 'Escape') {
        const open = [...document.querySelectorAll('.modal.active')].pop();
        if (open) closeModal(open.id);
    }
});

// Clics en contenido generado dinámicamente (data-action="..." data-*)
const ACTIONS = {
    editTransaction: d => openEditTransaction(Number(d.id)),
    deleteTransaction: d => removeTransactionWithUndo(Number(d.id)),
    setInvestmentValue: d => setInvestmentValue(d.value),
    editCategory: d => openCategoryModal(d.value),
    removeCategory: d => removeExpenseCategory(d.value),
    removeAccount: d => removeListItem('accounts', d.value),
    removeIncomeCategory: d => removeListItem('incomeCategories', d.value),
    addRecurring: d => addRecurring(Number(d.id)),
    skipRecurring: d => skipRecurring(Number(d.id)),
    editRecurringAmount: d => editRecurringAmount(Number(d.id)),
    deleteRecurring: d => deleteRecurring(Number(d.id)),
    openRecurring: () => openRecurringModal(),
    exportData: () => exportData(),
    dismissBackup: () => { backupBannerDismissed = true; renderBanners(); }
};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !ACTIONS[el.dataset.action]) return;
    e.preventDefault();
    e.stopPropagation();
    ACTIONS[el.dataset.action](el.dataset, e);
});

// Clic fuera de una ventana la cierra
window.addEventListener('click', e => {
    if (e.target.classList.contains('modal')) closeModal(e.target.id);
});

// ============================================
// GESTIÓN DE DATOS
// ============================================

function loadData() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (err) { console.error('Datos corruptos', err); }
    if (!stored) return;
    const { normalized, orphans } = normalizeData(stored);
    data = normalized;
    if (orphans.length) {
        saveData();
        pendingStartupMessage = `Categorías sin grupo movidas a "${data.categoryGroups.ocio?.name || 'otro grupo'}": ${orphans.join(', ')}. Pulsa la categoría en Inversiones para cambiarla de grupo.`;
    }
}

// Completa campos que falten (datos antiguos o importados) y arregla categorías sueltas
function normalizeData(raw) {
    const d = Object.assign(createDefaultData(), raw);
    if (!d.categoryGroups || typeof d.categoryGroups !== 'object') d.categoryGroups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
    for (const [key, group] of Object.entries(DEFAULT_GROUPS)) {
        if (!d.categoryGroups[key]) d.categoryGroups[key] = JSON.parse(JSON.stringify(group));
        if (!Array.isArray(d.categoryGroups[key].categories)) d.categoryGroups[key].categories = [];
    }
    if (!Array.isArray(d.transactions)) d.transactions = [];
    if (!Array.isArray(d.accounts) || !d.accounts.length) d.accounts = [...DEFAULT_ACCOUNTS];
    if (!Array.isArray(d.incomeCategories) || !d.incomeCategories.length) d.incomeCategories = [...DEFAULT_INCOME_CATEGORIES];
    if (!Array.isArray(d.recurring)) d.recurring = [];
    if (!d.investmentValues || typeof d.investmentValues !== 'object') d.investmentValues = {};
    if (!(d.emergencyGoal > 0)) d.emergencyGoal = 5000;

    d.transactions = d.transactions.filter(t => t && typeof t.month === 'string');
    d.transactions.forEach(t => { t.amount = Number(t.amount) || 0; });

    // Gastos cuya categoría no está en ningún grupo → se añaden a Ocio para que cuenten
    const known = new Set(Object.values(d.categoryGroups).flatMap(g => g.categories));
    const orphans = [...new Set(d.transactions.filter(t => t.type === 'expense' && !known.has(t.category)).map(t => t.category))];
    const target = d.categoryGroups.ocio || Object.values(d.categoryGroups)[0];
    target.categories.push(...orphans);

    return { normalized: d, orphans };
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function newId() {
    let id = Date.now();
    if (id <= lastId) id = lastId + 1;
    lastId = id;
    return id;
}

// ============================================
// HELPERS
// ============================================

const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const pad = n => String(n).padStart(2, '0');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeText(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function getAllCategories() {
    return Object.values(data.categoryGroups).flatMap(g => g.categories);
}

function findCategoryGroup(category) {
    return Object.keys(data.categoryGroups).find(key => data.categoryGroups[key].categories.includes(category));
}

function isInvestmentCategory(category) {
    return data.categoryGroups.inversion.categories.includes(category);
}

// Ajuste de patrimonio: resta del patrimonio pero no cuenta como gasto real
function isAdjustment(t) {
    const desc = (t.description || '').toUpperCase();
    return desc.includes('REGULACION') || desc.includes('AJUSTE');
}

// Filtros de transacciones
const isIncome = t => t.type === 'income';
const isInvestment = t => t.type === 'expense' && isInvestmentCategory(t.category);
const isNonInvestmentExpense = t => t.type === 'expense' && !isInvestmentCategory(t.category);
const isRealExpense = t => isNonInvestmentExpense(t) && !isAdjustment(t);
const inMonth = month => t => t.month === month;
const inYear = year => t => t.month.startsWith(String(year));

function txWhere(...predicates) {
    return data.transactions.filter(t => predicates.every(p => p(t)));
}

function sumAmounts(list) {
    return list.reduce((s, t) => s + t.amount, 0);
}

function sumBy(list, keyFn) {
    const totals = {};
    list.forEach(t => { const k = keyFn(t); totals[k] = (totals[k] || 0) + t.amount; });
    return totals;
}

// Orden: mes, día y fecha de creación (más reciente primero)
function compareTransactions(a, b) {
    return b.month.localeCompare(a.month) || (b.day || 0) - (a.day || 0) || String(b.date || '').localeCompare(String(a.date || ''));
}

// Fechas
function monthKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; }
function getCurrentMonth() { return monthKey(new Date()); }
function getCurrentYear() { return new Date().getFullYear(); }
function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
}
function daysInMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
}
function todayISO() {
    const d = new Date();
    return `${monthKey(d)}-${pad(d.getDate())}`;
}
function splitDate(iso) {
    return { month: iso.slice(0, 7), day: Number(iso.slice(8, 10)) };
}
function formatMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}
function monthName(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
}
function formatShortMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
}
function formatTxDate(t) {
    if (!t.day) return formatMonth(t.month);
    const [y, m] = t.month.split('-').map(Number);
    return new Date(y, m - 1, t.day).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDate(iso) {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysSince(iso) {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function formatCurrency(amount) {
    return (amount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€';
}
function formatPercent(value, decimals = 1) {
    return value === null || !Number.isFinite(value) ? '—' : value.toFixed(decimals) + '%';
}
// Acepta "12,5", "12.5" y "1.234,56"
function parseAmount(value) {
    let text = String(value ?? '').trim().replace(/\s|€/g, '');
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, ''); // "1.500" = mil quinientos
    if (!/^-?\d*\.?\d+$/.test(text)) return null;
    return parseFloat(text);
}

// Etiqueta "▲ 12% vs julio". higherIsBad: para gastos subir es malo
function deltaBadge(current, previous, prevLabel, higherIsBad = true) {
    if (!previous) return '';
    const pct = ((current - previous) / previous) * 100;
    if (Math.abs(pct) < 0.5) return `<span class="delta neutral">= que ${escapeHtml(prevLabel)}</span>`;
    const up = pct > 0;
    const bad = up === higherIsBad;
    return `<span class="delta ${bad ? 'bad' : 'good'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs ${escapeHtml(prevLabel)}</span>`;
}

function optionsHtml(values, selected) {
    return values.map(v => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

// Desplegable de categorías. Si la categoría actual ya no existe, se añade para no cambiarla sin querer
function categoryOptionsHtml(type, selected) {
    if (type === 'income') {
        const cats = selected && !data.incomeCategories.includes(selected) ? [...data.incomeCategories, selected] : data.incomeCategories;
        return optionsHtml(cats, selected);
    }
    let html = Object.values(data.categoryGroups)
        .map(g => `<optgroup label="${escapeHtml(g.name)}">${optionsHtml(g.categories, selected)}</optgroup>`).join('');
    if (selected && !getAllCategories().includes(selected)) html += `<optgroup label="Sin grupo">${optionsHtml([selected], selected)}</optgroup>`;
    return html;
}

function accountOptionsHtml(selected) {
    const accounts = selected && !data.accounts.includes(selected) ? [...data.accounts, selected] : data.accounts;
    return optionsHtml(accounts, selected);
}

// ============================================
// CÁLCULOS FINANCIEROS
// ============================================

function getTotalInvested() { return sumAmounts(txWhere(isInvestment)); }
function getEmergencyFundTotal() { return sumAmounts(txWhere(t => t.type === 'expense' && t.category === 'Colchón')); }
function getInvestmentByCategory() { return sumBy(txWhere(isInvestment), t => t.category); }

// PATRIMONIO = Ingresos - Gastos (las inversiones NO restan, los ajustes SÍ restan)
function getPatrimony() {
    return sumAmounts(txWhere(isIncome)) - sumAmounts(txWhere(isNonInvestmentExpense));
}

function getAvailable() { return getPatrimony() - getTotalInvested(); }

function getMonthSummary(month) {
    const income = sumAmounts(txWhere(isIncome, inMonth(month)));
    const expenses = sumAmounts(txWhere(isRealExpense, inMonth(month)));
    return { income, expenses, savingsRate: income > 0 ? ((income - expenses) / income) * 100 : null };
}

function getTotalSavingsRate() {
    const income = sumAmounts(txWhere(isIncome));
    const expenses = sumAmounts(txWhere(isRealExpense));
    return income > 0 ? ((income - expenses) / income) * 100 : null;
}

// Valor actual de una inversión: el que apuntó el usuario, o lo aportado si no hay
function getInvestmentStatus(category, contributed) {
    const saved = data.investmentValues[category];
    if (!saved) return { value: contributed, hasValue: false, stale: false };
    const stale = data.transactions.some(t => isInvestment(t) && t.category === category && String(t.date || '') > saved.updated);
    return { value: saved.value, hasValue: true, stale, updated: saved.updated };
}

// ============================================
// NAVEGACIÓN Y REFRESCO
// ============================================

function showSection(sectionId) {
    currentSection = sectionId;
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === sectionId));
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === sectionId));
    renderSection(sectionId);
}

function renderSection(sectionId) {
    if (sectionId === 'dashboard') updateDashboard();
    if (sectionId === 'inversiones') renderInvestmentPanel();
    if (sectionId === 'estadisticas') updateStats();
    if (sectionId === 'datos') renderSettings();
}

// Redibuja todo lo visible tras cualquier cambio en los datos
function refreshAll() {
    updateMonthFilters();
    updateCategoryFilter();
    updateHeaderStats();
    renderBanners();
    renderSection(currentSection);
}

// ============================================
// CONFIGURACIÓN INICIAL
// ============================================

function completeSetup() {
    const goal = parseAmount($('setupEmergencyGoal').value);
    if (!(goal > 0)) { showNotification('Ingresa una meta válida', 'warning'); return; }
    data.emergencyGoal = goal;
    data.setupComplete = true;
    saveData();
    renderInvestmentPanel();
    showNotification('Configuración completada', 'success');
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
    const pending = getPendingRecurring();
    if (pending.length) {
        html += `<div class="banner">
            <span>🔁 ${pending.length} movimiento${pending.length > 1 ? 's' : ''} recurrente${pending.length > 1 ? 's' : ''} pendiente${pending.length > 1 ? 's' : ''} en ${escapeHtml(formatMonth(getCurrentMonth()))}</span>
            <button class="btn-primary btn-small" data-action="openRecurring">Revisar</button>
        </div>`;
    }
    const needsBackup = data.transactions.length > 0 && (!data.lastBackup || daysSince(data.lastBackup) >= BACKUP_REMINDER_DAYS);
    if (needsBackup && !backupBannerDismissed) {
        const text = data.lastBackup ? `Tu último backup fue hace ${daysSince(data.lastBackup)} días` : 'Aún no has hecho ningún backup';
        html += `<div class="banner warning">
            <span>💾 ${text}</span>
            <span class="banner-actions">
                <button class="btn-primary btn-small" data-action="exportData">Descargar</button>
                <button class="btn-secondary btn-small" data-action="dismissBackup">Más tarde</button>
            </span>
        </div>`;
    }
    setHtml('banners', html);
}

// ============================================
// DASHBOARD
// ============================================

function updateDashboard() {
    updateTransactionLists();
}

function updateHeaderStats() {
    const month = getCurrentMonth();
    const prevMonth = shiftMonth(month, -1);
    const prevLabel = monthName(prevMonth);
    const cur = getMonthSummary(month);
    const prev = getMonthSummary(prevMonth);
    const patrimony = formatCurrency(getPatrimony());
    const incomeDelta = deltaBadge(cur.income, prev.income, prevLabel, false);
    const expensesDelta = deltaBadge(cur.expenses, prev.expenses, prevLabel, true);

    setText('monthlyIncome', formatCurrency(cur.income));
    setText('monthlyExpenses', formatCurrency(cur.expenses));
    setText('savingsRate', formatPercent(cur.savingsRate));
    setText('savingsRateTotal', 'Histórico: ' + formatPercent(getTotalSavingsRate()));
    setText('totalPatrimony', patrimony);
    setHtml('incomeDelta', incomeDelta);
    setHtml('expensesDelta', expensesDelta);

    setText('mobileIncome', '+' + formatCurrency(cur.income));
    setText('mobileExpenses', '-' + formatCurrency(cur.expenses));
    setText('mobilePatrimony', patrimony);
    setText('mobileSavings', formatPercent(cur.savingsRate, 0));
    setHtml('mobileIncomeDelta', incomeDelta);
    setHtml('mobileExpensesDelta', expensesDelta);
}

function matchesSearch(t, query) {
    const haystack = normalizeText([t.category, t.description, t.account, t.amount.toFixed(2), String(t.amount).replace('.', ',')].join(' '));
    return haystack.includes(query);
}

function updateTransactionLists() {
    const query = normalizeText($('txSearch').value.trim());
    const [filterType, filterCat] = ($('txCategoryFilter').value || ':').split(/:(.*)/);

    const renderList = ({ predicate, type, monthSelectId, containerId, totalId, sign, cls, emptyText }) => {
        const month = $(monthSelectId).value;
        let list = txWhere(predicate);
        if (month) list = list.filter(t => t.month === month);
        if (filterCat) list = filterType === type ? list.filter(t => t.category === filterCat) : [];
        if (query) list = list.filter(t => matchesSearch(t, query));
        list.sort(compareTransactions);

        setText(totalId, formatCurrency(sumAmounts(list)));
        setHtml(containerId, list.length ? list.map(t => transactionItemHtml(t, sign, cls)).join('') : `<p class="empty-message">${emptyText}</p>`);
    };

    renderList({ predicate: isRealExpense, type: 'expense', monthSelectId: 'filterExpensesMonth', containerId: 'expensesList', totalId: 'expensesTotal', sign: '-', cls: 'negative', emptyText: 'No hay gastos' });
    renderList({ predicate: isIncome, type: 'income', monthSelectId: 'filterIncomesMonth', containerId: 'incomesList', totalId: 'incomesTotal', sign: '+', cls: 'positive', emptyText: 'No hay ingresos' });
}

function transactionItemHtml(t, sign, cls) {
    return `<div class="transaction-item" data-action="editTransaction" data-id="${t.id}">
        <div class="transaction-row">
            <span class="transaction-category">${escapeHtml(t.category)}</span>
            <span class="transaction-amount ${cls}">${sign}${formatCurrency(t.amount)}</span>
        </div>
        <div class="transaction-meta"><span>${escapeHtml(t.account || 'Efectivo')}</span><span>${escapeHtml(formatTxDate(t))}</span></div>
        ${t.description ? `<div class="transaction-description">${escapeHtml(t.description)}</div>` : ''}
    </div>`;
}

// Rellena los filtros de mes. Mantiene la selección actual; al arrancar elige el mes en curso
function updateMonthFilters(selectCurrent = false) {
    const currentMonth = getCurrentMonth();
    [['filterExpensesMonth', isRealExpense], ['filterIncomesMonth', isIncome]].forEach(([id, predicate]) => {
        const select = $(id);
        const months = [...new Set(txWhere(predicate).map(t => t.month))].sort().reverse();
        const previous = select.value;
        select.innerHTML = '<option value="">Todos los meses</option>' + months.map(m => `<option value="${m}">${escapeHtml(formatMonth(m))}</option>`).join('');
        if (selectCurrent) select.value = months.includes(currentMonth) ? currentMonth : '';
        else select.value = months.includes(previous) ? previous : '';
    });
}

function updateCategoryFilter() {
    const select = $('txCategoryFilter');
    const previous = select.value;
    const option = (type, cat) => `<option value="${type}:${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
    const expenseCats = Object.entries(data.categoryGroups).filter(([key]) => key !== 'inversion').flatMap(([, g]) => g.categories);
    select.innerHTML = '<option value="">Todas las categorías</option>'
        + `<optgroup label="Gastos">${expenseCats.map(c => option('expense', c)).join('')}</optgroup>`
        + `<optgroup label="Ingresos">${data.incomeCategories.map(c => option('income', c)).join('')}</optgroup>`;
    select.value = [...select.options].some(o => o.value === previous) ? previous : '';
}

// ============================================
// TRANSACCIONES
// ============================================

function openAddTransaction(type) {
    $('transactionType').value = type;
    $('transactionModalTitle').textContent = type === 'income' ? 'Nuevo Ingreso' : 'Nuevo Gasto';
    $('transactionAmount').value = '';
    $('transactionDescription').value = '';
    $('transactionDate').value = todayISO();
    $('transactionRecurring').checked = false;
    $('transactionCategory').innerHTML = categoryOptionsHtml(type);
    $('transactionAccount').innerHTML = accountOptionsHtml(data.accounts.includes(data.lastAccount) ? data.lastAccount : data.accounts[0]);
    openModal('addTransactionModal', 'transactionAmount');
}

function saveTransaction() {
    const type = $('transactionType').value;
    const dateValue = $('transactionDate').value;
    const amount = parseAmount($('transactionAmount').value);
    const category = $('transactionCategory').value;
    const account = $('transactionAccount').value;
    const description = $('transactionDescription').value.trim();

    if (!(amount > 0)) { showNotification('Introduce un monto mayor que 0', 'warning'); return; }
    if (!dateValue) { showNotification('Elige una fecha', 'warning'); return; }

    const { month, day } = splitDate(dateValue);
    data.transactions.push({ id: newId(), type, month, day, amount, category, account, description, date: new Date().toISOString() });
    data.lastAccount = account;
    if ($('transactionRecurring').checked) {
        data.recurring.push({ id: newId(), type, category, amount, account, description, day, lastMonth: month });
    }
    saveData();
    closeModal('addTransactionModal');
    refreshAll();
    showNotification('Transacción guardada', 'success');
}

function openEditTransaction(id) {
    const t = data.transactions.find(t => t.id === id);
    if (!t) return;
    $('editTransactionId').value = t.id;
    $('editTransactionTitle').textContent = t.type === 'income' ? 'Editar Ingreso' : 'Editar Gasto';
    $('editAmount').value = String(t.amount).replace('.', ',');
    $('editDate').value = `${t.month}-${pad(t.day || 1)}`;
    $('editCategory').innerHTML = categoryOptionsHtml(t.type, t.category);
    $('editAccount').innerHTML = accountOptionsHtml(t.account || 'Efectivo');
    $('editDescription').value = t.description || '';
    openModal('editTransactionModal');
}

function saveEditedTransaction() {
    const t = data.transactions.find(t => t.id === Number($('editTransactionId').value));
    if (!t) return;
    const amount = parseAmount($('editAmount').value);
    const dateValue = $('editDate').value;
    if (!(amount > 0)) { showNotification('Introduce un monto mayor que 0', 'warning'); return; }
    if (!dateValue) { showNotification('Elige una fecha', 'warning'); return; }

    const { month, day } = splitDate(dateValue);
    // Los movimientos antiguos no tenían día: si no se tocó la fecha, se quedan sin día
    const untouchedOldDate = !t.day && month === t.month && day === 1;
    t.month = month;
    if (!untouchedOldDate) t.day = day;
    t.amount = amount;
    t.category = $('editCategory').value;
    t.account = $('editAccount').value;
    t.description = $('editDescription').value.trim();

    saveData();
    closeModal('editTransactionModal');
    refreshAll();
    showNotification('Actualizada', 'success');
}

function deleteTransaction() {
    const id = Number($('editTransactionId').value);
    closeModal('editTransactionModal');
    removeTransactionWithUndo(id);
}

function removeTransactionWithUndo(id) {
    const index = data.transactions.findIndex(t => t.id === id);
    if (index < 0) return;
    const [removed] = data.transactions.splice(index, 1);
    saveData();
    refreshAll();
    showNotification(`Eliminado: ${removed.category} ${formatCurrency(removed.amount)}`, 'success', {
        actionLabel: 'Deshacer',
        duration: UNDO_DURATION,
        onAction: () => {
            data.transactions.splice(index, 0, removed);
            saveData();
            refreshAll();
            showNotification('Restaurado', 'success');
        }
    });
}

// ============================================
// MOVIMIENTOS RECURRENTES
// ============================================

function recurringLabel(r) {
    return `${r.category}${r.description ? ' · ' + r.description : ''}`;
}

function openRecurringModal() {
    renderRecurringPending();
    openModal('recurringModal');
}

function renderRecurringPending() {
    const pending = getPendingRecurring();
    setText('recurringModalTitle', `Recurrentes de ${formatMonth(getCurrentMonth())}`);
    if (!pending.length) { closeModal('recurringModal'); return; }
    setHtml('recurringPendingList', pending.map(r => `
        <div class="recurring-item">
            <div class="recurring-info">
                <span class="transaction-category">${escapeHtml(recurringLabel(r))}</span>
                <small>${r.type === 'income' ? 'Ingreso' : 'Gasto'} · ${escapeHtml(r.account)}${r.day ? ' · día ' + r.day : ''}</small>
            </div>
            <input type="text" id="rec-amount-${r.id}" value="${String(r.amount).replace('.', ',')}" inputmode="decimal" aria-label="Monto">
            <div class="recurring-actions">
                <button class="btn-primary btn-small" data-action="addRecurring" data-id="${r.id}">Añadir</button>
                <button class="btn-secondary btn-small" data-action="skipRecurring" data-id="${r.id}">Omitir</button>
            </div>
        </div>`).join(''));
}

function addRecurring(id, { silent = false } = {}) {
    const r = data.recurring.find(r => r.id === id);
    if (!r) return false;
    const input = $(`rec-amount-${id}`);
    const amount = input ? parseAmount(input.value) : r.amount;
    if (!(amount > 0)) { showNotification('Monto no válido', 'warning'); return false; }
    const month = getCurrentMonth();
    const day = r.day ? Math.min(r.day, daysInMonth(month)) : undefined;
    data.transactions.push({ id: newId(), type: r.type, month, day, amount, category: r.category, account: r.account, description: r.description, date: new Date().toISOString() });
    r.lastMonth = month;
    if (!silent) {
        saveData();
        refreshAll();
        renderRecurringPending();
        showNotification(`Añadido: ${recurringLabel(r)}`, 'success');
    }
    return true;
}

function addAllRecurring() {
    const added = getPendingRecurring().filter(r => addRecurring(r.id, { silent: true })).length;
    saveData();
    refreshAll();
    renderRecurringPending();
    if (added) showNotification(`${added} movimiento${added > 1 ? 's' : ''} añadido${added > 1 ? 's' : ''}`, 'success');
}

function skipRecurring(id) {
    const r = data.recurring.find(r => r.id === id);
    if (!r) return;
    r.lastMonth = getCurrentMonth();
    saveData();
    refreshAll();
    renderRecurringPending();
}

function editRecurringAmount(id) {
    const r = data.recurring.find(r => r.id === id);
    if (!r) return;
    openEditModal(`Monto de ${recurringLabel(r)}`, r.amount, value => {
        if (!(value > 0)) return 'Introduce un monto mayor que 0';
        r.amount = value;
        saveData();
        renderSettings();
        showNotification('Recurrente actualizado', 'success');
    });
}

function deleteRecurring(id) {
    const index = data.recurring.findIndex(r => r.id === id);
    if (index < 0) return;
    const [removed] = data.recurring.splice(index, 1);
    saveData();
    refreshAll();
    showNotification('Recurrente eliminado', 'success', {
        actionLabel: 'Deshacer',
        duration: UNDO_DURATION,
        onAction: () => { data.recurring.splice(index, 0, removed); saveData(); refreshAll(); }
    });
}

// ============================================
// INVERSIONES
// ============================================

function renderInvestmentPanel() {
    $('investmentSetup').style.display = data.setupComplete ? 'none' : 'block';
    $('investmentPanel').style.display = data.setupComplete ? 'block' : 'none';
    if (!data.setupComplete) return;
    const breakdown = getInvestmentByCategory();
    updateInvestmentSummary(breakdown);
    renderBubbleChart(breakdown);
    renderInvestmentsList();
    renderExpenseCategories();
}

function updateInvestmentSummary(breakdown) {
    const emergencyReal = getEmergencyFundTotal();
    const emergencyGoal = data.emergencyGoal || 5000;
    const emergencyPercent = Math.min((emergencyReal / emergencyGoal) * 100, 100);

    setText('emergencyCurrentText', formatCurrency(emergencyReal));
    setText('emergencyGoalText', formatCurrency(emergencyGoal));
    $('emergencyBarFill').style.width = emergencyPercent + '%';
    setText('emergencyPercentBig', emergencyPercent.toFixed(0) + '%');
    $('emergencyCompleteMsg').style.display = emergencyReal >= emergencyGoal ? 'block' : 'none';

    const totalInvested = Object.values(breakdown).reduce((s, a) => s + a, 0);
    setText('invTotalInvested', formatCurrency(totalInvested));

    // Valor actual total (usa lo aportado en las inversiones sin valor apuntado)
    const entries = Object.entries(breakdown);
    const anyValue = entries.some(([cat]) => data.investmentValues[cat]);
    if (anyValue) {
        const totalValue = entries.reduce((s, [cat, amount]) => s + getInvestmentStatus(cat, amount).value, 0);
        const gain = totalValue - totalInvested;
        const pct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;
        setHtml('investmentValueSummary', `Valor actual: <strong>${formatCurrency(totalValue)}</strong>
            <span class="${gain >= 0 ? 'positive' : 'negative'}">(${gain >= 0 ? '+' : ''}${formatCurrency(gain)} · ${gain >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span>`);
    } else {
        setHtml('investmentValueSummary', '');
    }

    setHtml('investmentDistribution', entries.length && totalInvested > 0
        ? entries.map(([cat, amount]) => `<div class="distribution-item"><span>${escapeHtml(cat)}</span><span>${((amount / totalInvested) * 100).toFixed(0)}%</span></div>`).join('')
        : '<small>Sin inversiones</small>');

    setText('availableThisMonth', formatCurrency(getAvailable()));
    setText('availableBreakdown', `Patrimonio (${formatCurrency(getPatrimony())}) - Invertido (${formatCurrency(totalInvested)})`);
}

function editEmergencyGoal() {
    openEditModal('Meta Colchón', data.emergencyGoal, value => {
        if (!(value > 0)) return 'Introduce una meta mayor que 0';
        data.emergencyGoal = value;
        saveData();
        renderInvestmentPanel();
        showNotification('Meta actualizada', 'success');
    });
}

function renderInvestmentsList() {
    const investments = txWhere(isInvestment);
    if (!investments.length) { setHtml('investmentsList', '<p class="empty-message">No hay inversiones registradas</p>'); return; }

    const grouped = {};
    investments.forEach(inv => (grouped[inv.category] ||= []).push(inv));

    setHtml('investmentsList', Object.entries(grouped).map(([category, invs]) => {
        const total = sumAmounts(invs);
        const status = getInvestmentStatus(category, total);
        const gain = status.value - total;
        const pct = total > 0 ? (gain / total) * 100 : 0;
        const valueLine = status.hasValue
            ? `<div class="investment-value-line">Valor actual: <strong>${formatCurrency(status.value)}</strong>
                <span class="${gain >= 0 ? 'positive' : 'negative'}">${gain >= 0 ? '+' : ''}${formatCurrency(gain)} (${gain >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span>
                <small>· ${status.stale ? '⚠️ desactualizado, has aportado después del' : 'actualizado el'} ${escapeHtml(formatDate(status.updated))}</small></div>`
            : '';

        const items = invs.sort(compareTransactions).map(inv => `
            <div class="investment-item">
                <div class="investment-item-row">
                    <span class="investment-item-date">${escapeHtml(formatTxDate(inv))}</span>
                    <span class="investment-item-amount">${formatCurrency(inv.amount)}</span>
                </div>
                ${inv.description ? `<div class="investment-item-description">${escapeHtml(inv.description)}</div>` : ''}
                <div class="investment-item-actions">
                    <button class="btn-secondary btn-small" data-action="editTransaction" data-id="${inv.id}">Editar</button>
                    <button class="btn-danger btn-small" data-action="deleteTransaction" data-id="${inv.id}">Eliminar</button>
                </div>
            </div>`).join('');

        return `<details class="investment-group">
            <summary class="investment-group-header">
                <span class="investment-group-category">${escapeHtml(category)} <small>(${invs.length})</small></span>
                <span class="investment-group-total">Aportado ${formatCurrency(total)}</span>
                <button class="btn-secondary btn-small" data-action="setInvestmentValue" data-value="${escapeHtml(category)}">Valor actual</button>
            </summary>
            ${valueLine}
            ${items}
        </details>`;
    }).join(''));
}

function setInvestmentValue(category) {
    const saved = data.investmentValues[category];
    const contributed = sumAmounts(txWhere(isInvestment, t => t.category === category));
    openEditModal(`Valor actual de ${category}`, saved ? saved.value : '', value => {
        if (value === null) {
            delete data.investmentValues[category];
        } else {
            if (value < 0) return 'El valor no puede ser negativo';
            data.investmentValues[category] = { value, updated: new Date().toISOString() };
        }
        saveData();
        renderInvestmentPanel();
        showNotification('Valor actualizado', 'success');
    }, { label: 'Valor hoy (€)', hint: `Aportado: ${formatCurrency(contributed)}. Déjalo vacío para quitar el valor.`, allowEmpty: true });
}

function renderBubbleChart(breakdown) {
    const entries = Object.entries(breakdown);
    if (!entries.length) {
        setHtml('investmentBubbles', '<div class="empty-bubbles"><p>No hay inversiones</p><p class="empty-hint">Añade gastos en "Inversión"</p></div>');
        return;
    }
    const maxAmount = Math.max(...entries.map(([, a]) => a));
    setHtml('investmentBubbles', entries.map(([cat, amount], i) => {
        const size = 80 + (amount / maxAmount) * 80;
        return `<div class="bubble" style="width:${size}px;height:${size}px;background:${BUBBLE_COLORS[i % BUBBLE_COLORS.length]}" title="${escapeHtml(cat)}: ${formatCurrency(amount)}">
            <span class="bubble-name">${escapeHtml(cat)}</span><span class="bubble-amount">${formatCurrency(amount)}</span>
        </div>`;
    }).join(''));
}

// ============================================
// CATEGORÍAS DE GASTO
// ============================================

function renderExpenseCategories() {
    setHtml('expenseCategoriesList', Object.values(data.categoryGroups).map(group => `
        <details class="category-group" open>
            <summary class="category-group-header">
                <span class="category-group-title">${escapeHtml(group.name)}</span><span class="category-group-percent">${group.percent}%</span>
            </summary>
            <div class="category-tags">
                ${group.categories.map(cat => `<span class="category-tag">
                    <button class="category-name" data-action="editCategory" data-value="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
                    <button class="category-remove" data-action="removeCategory" data-value="${escapeHtml(cat)}" aria-label="Eliminar ${escapeHtml(cat)}">×</button>
                </span>`).join('')}
            </div>
        </details>`).join(''));
}

function groupOptionsHtml(selectedKey) {
    return Object.entries(data.categoryGroups)
        .map(([key, g]) => `<option value="${key}"${key === selectedKey ? ' selected' : ''}>${escapeHtml(g.name)} (${g.percent}%)</option>`).join('');
}

// Sin argumento: nueva categoría. Con nombre: renombrar / mover de grupo
function openCategoryModal(category = '') {
    const groupKey = category ? findCategoryGroup(category) : 'ocio';
    $('categoryModalTitle').textContent = category ? 'Editar Categoría' : 'Nueva Categoría';
    $('categoryOriginal').value = category;
    $('categoryName').value = category;
    $('categoryGroup').innerHTML = groupOptionsHtml(groupKey);
    openModal('categoryModal', 'categoryName');
}

function saveCategory() {
    const name = $('categoryName').value.trim();
    const groupKey = $('categoryGroup').value;
    const original = $('categoryOriginal').value;
    if (!name) { showNotification('Ingresa un nombre', 'warning'); return; }
    if (name !== original && getAllCategories().includes(name)) { showNotification('Ya existe', 'warning'); return; }

    if (original) {
        const oldKey = findCategoryGroup(original);
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
    showNotification(original ? 'Categoría actualizada' : 'Añadida', 'success');
}

// Cambia la categoría en todos los gastos, recurrentes y valores de inversión
function renameExpenseCategory(from, to) {
    data.transactions.forEach(t => { if (t.type === 'expense' && t.category === from) t.category = to; });
    data.recurring.forEach(r => { if (r.type === 'expense' && r.category === from) r.category = to; });
    if (data.investmentValues[from]) {
        if (!data.investmentValues[to]) data.investmentValues[to] = data.investmentValues[from];
        delete data.investmentValues[from];
    }
}

function countCategoryUsage(category) {
    return data.transactions.filter(t => t.type === 'expense' && t.category === category).length
        + data.recurring.filter(r => r.type === 'expense' && r.category === category).length;
}

function removeExpenseCategory(category) {
    const groupKey = findCategoryGroup(category);
    if (!groupKey) return;
    const used = countCategoryUsage(category);
    if (!used) {
        if (!confirm(`¿Eliminar "${category}"?`)) return;
        const list = data.categoryGroups[groupKey].categories;
        list.splice(list.indexOf(category), 1);
        saveData();
        refreshAll();
        showNotification('Eliminada', 'success');
        return;
    }
    // En uso: hay que mover sus movimientos a otra categoría para no perderlos
    $('reassignFrom').value = category;
    $('reassignText').textContent = `"${category}" tiene ${used} movimiento${used > 1 ? 's' : ''}. Para no perderlos de las estadísticas, elige a qué categoría moverlos.`;
    $('reassignTo').innerHTML = Object.values(data.categoryGroups)
        .map(g => `<optgroup label="${escapeHtml(g.name)}">${optionsHtml(g.categories.filter(c => c !== category))}</optgroup>`).join('');
    openModal('reassignCategoryModal');
}

function confirmReassignCategory() {
    const from = $('reassignFrom').value;
    const to = $('reassignTo').value;
    const groupKey = findCategoryGroup(from);
    if (!to || !groupKey) return;
    renameExpenseCategory(from, to);
    const list = data.categoryGroups[groupKey].categories;
    list.splice(list.indexOf(from), 1);
    saveData();
    closeModal('reassignCategoryModal');
    refreshAll();
    showNotification(`"${from}" eliminada, movimientos movidos a "${to}"`, 'success');
}

// ============================================
// AJUSTES (sección Datos)
// ============================================

function renderSettings() {
    setText('lastBackupText', data.lastBackup
        ? `Último backup: ${formatDate(data.lastBackup)} (hace ${daysSince(data.lastBackup)} días)`
        : 'Aún no has hecho ningún backup');

    const tags = (list, action) => list.map(v => `<span class="category-tag">${escapeHtml(v)}
        <button class="category-remove" data-action="${action}" data-value="${escapeHtml(v)}" aria-label="Eliminar ${escapeHtml(v)}">×</button></span>`).join('');
    setHtml('accountsList', tags(data.accounts, 'removeAccount'));
    setHtml('incomeCategoriesList', tags(data.incomeCategories, 'removeIncomeCategory'));

    setHtml('recurringSettingsList', data.recurring.length ? data.recurring.map(r => `
        <div class="recurring-item">
            <div class="recurring-info">
                <span class="transaction-category">${escapeHtml(recurringLabel(r))}</span>
                <small>${r.type === 'income' ? 'Ingreso' : 'Gasto'} · ${formatCurrency(r.amount)} · ${escapeHtml(r.account)}${r.day ? ' · día ' + r.day : ''}</small>
            </div>
            <div class="recurring-actions">
                <button class="btn-secondary btn-small" data-action="editRecurringAmount" data-id="${r.id}">Monto</button>
                <button class="btn-danger btn-small" data-action="deleteRecurring" data-id="${r.id}">Eliminar</button>
            </div>
        </div>`).join('') : '<p class="empty-message">No tienes movimientos recurrentes</p>');
}

function addListItem(listKey, inputId) {
    const input = $(inputId);
    const value = input.value.trim();
    if (!value) return;
    if (data[listKey].includes(value)) { showNotification('Ya existe', 'warning'); return; }
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

// ============================================
// ESTADÍSTICAS
// ============================================

async function updateStats() {
    updateDistributionCard();
    updateDistributionChartLabels();
    try {
        await loadChartJs();
        $('chartsError').style.display = 'none';
    } catch {
        $('chartsError').style.display = 'block';
        return;
    }
    if (currentSection !== 'estadisticas') return;
    updateEvolutionChart();
    updateDistributionChart();
}

let chartJsPromise = null;
function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    if (!chartJsPromise) {
        chartJsPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = CHART_JS_URL;
            script.onload = resolve;
            script.onerror = () => { chartJsPromise = null; script.remove(); reject(new Error('No se pudo cargar Chart.js')); };
            document.head.appendChild(script);
        });
    }
    return chartJsPromise;
}

function updateDistributionCard() {
    const month = distributionState.currentMonth;
    const groups = Object.entries(data.categoryGroups);
    setText('distributionTitle', 'Distribución ' + groups.map(([, g]) => g.percent).join('/'));
    setText('distributionMonthLabel', formatMonth(month));

    const monthIncome = sumAmounts(txWhere(isIncome, inMonth(month)));
    setText('distMonthIncome', formatCurrency(monthIncome));

    const monthExpenses = txWhere(t => t.type === 'expense' && !isAdjustment(t), inMonth(month));
    setHtml('distributionGroups', groups.map(([key, group]) => {
        const target = monthIncome * (group.percent / 100);
        const spent = sumAmounts(monthExpenses.filter(t => group.categories.includes(t.category)));
        const percent = target > 0 ? (spent / target) * 100 : 0;
        const isOver = spent > target;
        const diff = Math.abs(target - spent);
        return `<div class="distribution-group">
            <div class="distribution-group-header"><span class="distribution-group-title">${escapeHtml(group.name)} (${group.percent}%)</span><span class="distribution-group-target">${formatCurrency(target)}</span></div>
            <div class="distribution-progress"><div class="progress-bar-container"><div class="progress-bar-fill ${isOver ? 'over' : 'under'}" style="width:${Math.min(percent, 100)}%"></div></div></div>
            <div class="distribution-stats"><span>${formatCurrency(spent)} ${key === 'inversion' ? 'movidos' : 'gastados'}</span><span class="distribution-status ${isOver ? 'negative' : 'positive'}">${isOver ? '¡Pasado ' + formatCurrency(diff) + '!' : 'Faltan ' + formatCurrency(diff)}</span></div>
        </div>`;
    }).join(''));
}

function changeDistributionMonth(delta) {
    distributionState.currentMonth = shiftMonth(distributionState.currentMonth, delta);
    updateDistributionCard();
}

function editDistributionConfig() {
    setHtml('distributionConfigList', Object.entries(data.categoryGroups).map(([key, group]) =>
        `<div class="form-group"><label for="config-${key}">${escapeHtml(group.name)}</label><input type="number" id="config-${key}" value="${group.percent}" min="0" max="100" inputmode="numeric"></div>`
    ).join(''));
    openModal('distributionConfigModal');
}

function saveDistributionConfig() {
    const values = Object.keys(data.categoryGroups).map(key => [key, parseInt($('config-' + key).value) || 0]);
    const total = values.reduce((s, [, v]) => s + v, 0);
    // Valida antes de tocar los datos para no dejar porcentajes a medias
    if (total !== 100) { showNotification(`Suman ${total}%, deben ser 100%`, 'warning'); return; }
    values.forEach(([key, v]) => { data.categoryGroups[key].percent = v; });
    saveData();
    closeModal('distributionConfigModal');
    refreshAll();
    showNotification('Guardado', 'success');
}

// Crea la gráfica la primera vez y después solo actualiza sus datos
function upsertChart(chart, canvasId, config) {
    if (chart) {
        chart.data = config.data;
        chart.update();
        return chart;
    }
    return new Chart($(canvasId), config);
}

function updateEvolutionChart() {
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(getCurrentMonth(), i - 11));
    const incomeByMonth = sumBy(txWhere(isIncome), t => t.month);
    const expenseByMonth = sumBy(txWhere(isRealExpense), t => t.month);

    evolutionChart = upsertChart(evolutionChart, 'evolutionChart', {
        type: 'line',
        data: {
            labels: months.map(formatShortMonth),
            datasets: [
                { label: 'Ingresos', data: months.map(m => incomeByMonth[m] || 0), borderColor: '#6b8e6b', backgroundColor: 'rgba(107,142,107,0.1)', tension: 0.4, fill: true },
                { label: 'Gastos', data: months.map(m => expenseByMonth[m] || 0), borderColor: '#b05a5a', backgroundColor: 'rgba(139,74,74,0.1)', tension: 0.4, fill: true }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#e8e8e8' } } },
            scales: { y: { beginAtZero: true, ticks: { color: '#b8b8b8' }, grid: { color: '#333' } }, x: { ticks: { color: '#b8b8b8' }, grid: { color: '#333' } } }
        }
    });
}

function updateDistributionChartLabels() {
    const label = chartState.isYearly ? String(chartState.currentYear) : formatMonth(chartState.currentMonth);
    setText('chartPeriodLabel', label);
    setText('toggleChartView', chartState.isYearly ? 'Ver Mensual' : 'Ver Anual');
    setText('distributionChartTitle', 'Gastos ' + label);
}

function updateDistributionChart() {
    if (!window.Chart) return;
    const periodFilter = chartState.isYearly ? inYear(chartState.currentYear) : inMonth(chartState.currentMonth);
    const totals = Object.entries(sumBy(txWhere(isRealExpense, periodFilter), t => t.category)).sort((a, b) => b[1] - a[1]);
    const isEmpty = totals.length === 0;

    $('distributionChartEmpty').style.display = isEmpty ? 'block' : 'none';
    $('distributionChartWrap').style.display = isEmpty ? 'none' : 'block';
    if (isEmpty) {
        if (distributionChart) { distributionChart.destroy(); distributionChart = null; }
        return;
    }

    distributionChart = upsertChart(distributionChart, 'distributionChart', {
        type: 'doughnut',
        data: {
            labels: totals.map(([cat]) => cat),
            datasets: [{ data: totals.map(([, v]) => v), backgroundColor: totals.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]) }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: window.innerWidth < 768 ? 'bottom' : 'right', labels: { color: '#e8e8e8', padding: 15 } },
                tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.parsed)}` } }
            }
        }
    });
}

function toggleChartView() {
    chartState.isYearly = !chartState.isYearly;
    updateDistributionChartLabels();
    updateDistributionChart();
}

function changeChartPeriod(delta) {
    if (chartState.isYearly) chartState.currentYear += delta;
    else chartState.currentMonth = shiftMonth(chartState.currentMonth, delta);
    updateDistributionChartLabels();
    updateDistributionChart();
}

// ============================================
// CALCULADORAS
// ============================================

function readNumber(id) {
    return parseAmount($(id).value);
}

function calculateMortgage() {
    const price = readNumber('housePrice'), down = readNumber('downPayment') ?? 0;
    const rate = readNumber('interestRate'), years = readNumber('years');
    if (!(price > 0) || rate === null || rate < 0 || !(years > 0) || down < 0 || down >= price) { showNotification('Revisa los campos', 'warning'); return; }
    const principal = price - down, monthlyRate = rate / 100 / 12, n = Math.round(years * 12);
    const monthlyPayment = monthlyRate === 0 ? principal / n : principal * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
    const totalPayment = monthlyPayment * n;
    setHtml('mortgageResult', `<strong>Préstamo:</strong> ${formatCurrency(principal)}<br><strong>Pago mensual:</strong> ${formatCurrency(monthlyPayment)}<br><strong>Total:</strong> ${formatCurrency(totalPayment)}<br><strong>Intereses:</strong> ${formatCurrency(totalPayment - principal)}`);
}

function calculateEmergencyFund() {
    const monthly = readNumber('calcMonthlyExpenses'), months = readNumber('monthsCoverage');
    if (!(monthly > 0) || !(months > 0)) { showNotification('Revisa los campos', 'warning'); return; }
    setHtml('emergencyFundResult', `<strong>Recomendado:</strong> ${formatCurrency(monthly * months)}<br><small>${months} meses × ${formatCurrency(monthly)}</small>`);
}

function calculateCAGR() {
    const initial = readNumber('initialValue'), final = readNumber('finalValue'), years = readNumber('cagrYears');
    if (!(initial > 0) || final === null || final < 0 || !(years > 0)) { showNotification('Revisa los campos', 'warning'); return; }
    setHtml('cagrResult', `<strong>CAGR:</strong> ${((Math.pow(final / initial, 1 / years) - 1) * 100).toFixed(2)}%`);
}

function calculateCompoundInterest() {
    const initial = readNumber('ciInitial') ?? 0, monthly = readNumber('ciMonthly') ?? 0;
    const rate = readNumber('ciRate'), years = readNumber('ciYears');
    if (initial < 0 || monthly < 0 || initial + monthly <= 0 || rate === null || rate < 0 || !(years > 0)) { showNotification('Revisa los campos', 'warning'); return; }
    const r = rate / 100 / 12, n = Math.round(years * 12);
    const growth = Math.pow(1 + r, n);
    const total = r === 0 ? initial + monthly * n : initial * growth + monthly * ((growth - 1) / r);
    const totalInvested = initial + monthly * n;
    setHtml('ciResult', `<strong>Invertido:</strong> ${formatCurrency(totalInvested)}<br><strong>Intereses:</strong> ${formatCurrency(total - totalInvested)}<br><strong>Total:</strong> ${formatCurrency(total)}`);
}

// ============================================
// MODALES Y NOTIFICACIONES
// ============================================

function openModal(id, focusId) {
    $(id).classList.add('active');
    document.body.classList.add('modal-open');
    if (focusId) setTimeout(() => $(focusId)?.focus(), 50);
}

function closeModal(id) {
    $(id).classList.remove('active');
    if (!document.querySelector('.modal.active')) document.body.classList.remove('modal-open');
}

// callback(valor) puede devolver un texto de error para no cerrar la ventana
function openEditModal(title, currentValue, callback, { label = 'Cantidad (€)', hint = '', allowEmpty = false } = {}) {
    setText('editValueTitle', title);
    setText('editValueLabel', label);
    setText('editValueHint', hint);
    $('editValueInput').value = String(currentValue).replace('.', ',');
    editValueCallback = { callback, allowEmpty };
    openModal('editValueModal', 'editValueInput');
}

function saveEditValue() {
    if (!editValueCallback) return;
    const raw = $('editValueInput').value.trim();
    const value = parseAmount(raw);
    if (value === null && !(raw === '' && editValueCallback.allowEmpty)) { showNotification('Introduce un número válido', 'warning'); return; }
    const error = editValueCallback.callback(value);
    if (error) { showNotification(error, 'warning'); return; }
    editValueCallback = null;
    closeModal('editValueModal');
}

function showNotification(message, type = 'info', { actionLabel, onAction, duration = 3000 } = {}) {
    document.querySelector('.notification')?.remove();
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
    close.textContent = '×';
    close.setAttribute('aria-label', 'Cerrar');
    close.onclick = () => n.remove();
    n.append(close);

    document.body.appendChild(n);
    setTimeout(() => n.remove(), duration);
}

// ============================================
// VENTANA DE DETALLES
// ============================================

function showDetailsPopup(type) {
    const month = getCurrentMonth(), year = getCurrentYear();
    const prevMonth = shiftMonth(month, -1);
    const prevLabel = monthName(prevMonth);
    const cur = getMonthSummary(month), prev = getMonthSummary(prevMonth);
    let title = '', html = '';

    if (type === 'income') {
        title = 'Ingresos';
        const yearly = sumAmounts(txWhere(isIncome, inYear(year)));
        html = `<div class="details-center">
            <p><strong>Este mes:</strong> <span class="positive">${formatCurrency(cur.income)}</span></p>
            <p>${deltaBadge(cur.income, prev.income, prevLabel, false) || '&nbsp;'}</p>
            <p><strong>Mes anterior:</strong> ${formatCurrency(prev.income)}</p>
            <p><strong>Año ${year}:</strong> <span class="positive">${formatCurrency(yearly)}</span></p>
        </div>`;
    } else if (type === 'expenses') {
        title = 'Gastos';
        const monthTx = txWhere(isRealExpense, inMonth(month));
        const prevByCat = sumBy(txWhere(isRealExpense, inMonth(prevMonth)), t => t.category);
        const yearly = sumAmounts(txWhere(isRealExpense, inYear(year)));
        const byCat = {};
        monthTx.forEach(t => (byCat[t.category] ||= []).push(t));
        const sorted = Object.entries(byCat).map(([cat, txs]) => [cat, txs, sumAmounts(txs)]).sort((a, b) => b[2] - a[2]);

        const breakdown = sorted.map(([cat, txs, total]) => `
            <details class="details-breakdown-group">
                <summary class="details-breakdown-item">
                    <span>${escapeHtml(cat)}</span>
                    <span class="details-breakdown-right">
                        ${deltaBadge(total, prevByCat[cat], prevLabel, true)}
                        <span class="negative">${formatCurrency(total)}</span>
                    </span>
                </summary>
                <div class="details-breakdown-detail">
                    ${[...txs].sort((a, b) => b.amount - a.amount).map(t => `
                        <div class="details-breakdown-sub" data-action="editTransaction" data-id="${t.id}">
                            <span class="sub-desc">${escapeHtml(t.description || '—')}</span>
                            <span class="sub-account">${escapeHtml(t.account || 'Efectivo')}</span>
                            <span class="negative sub-amount">${formatCurrency(t.amount)}</span>
                        </div>`).join('')}
                </div>
            </details>`).join('');

        html = `<div class="details-center">
                <p><strong>Este mes:</strong> <span class="negative">${formatCurrency(cur.expenses)}</span></p>
                <p>${deltaBadge(cur.expenses, prev.expenses, prevLabel, true) || '&nbsp;'}</p>
                <p><strong>Año ${year}:</strong> <span class="negative">${formatCurrency(yearly)}</span></p>
                ${sorted.length ? '<hr><p class="card-hint">Desglose — pulsa para expandir</p>' : ''}
            </div>
            <div class="details-breakdown">${breakdown}</div>`;
    } else if (type === 'savings') {
        title = 'Tasa de Ahorro';
        const total = getTotalSavingsRate();
        html = `<div class="details-center">
            <h2 class="highlight">${formatPercent(cur.savingsRate)}</h2>
            <p class="details-subtitle">${cur.savingsRate === null ? 'Sin ingresos este mes' : `Este mes, de cada 100€ ahorras ${cur.savingsRate.toFixed(0)}€`}</p>
            <hr>
            <p><strong>Mes anterior:</strong> ${formatPercent(prev.savingsRate)}</p>
            <p><strong>Histórico:</strong> ${formatPercent(total)}</p>
        </div>`;
    } else if (type === 'patrimony') {
        title = 'Patrimonio';
        const p = getPatrimony(), i = getTotalInvested(), a = getAvailable();
        html = `<div class="details-center"><h2 class="highlight">${formatCurrency(p)}</h2><p class="details-subtitle">Ingresos - Gastos reales</p></div>
            <div class="patrimony-bubbles">
                <div class="patrimony-bubble" style="background:#6b8e6b"><span class="patrimony-bubble-name">Invertido</span><span class="patrimony-bubble-amount">${formatCurrency(i)}</span></div>
                <div class="patrimony-bubble" style="background:${a >= 0 ? '#4a90a4' : '#8b4a4a'}"><span class="patrimony-bubble-name">Disponible</span><span class="patrimony-bubble-amount">${formatCurrency(a)}</span></div>
            </div>`;
    }
    setText('detailsTitle', title);
    setHtml('detailsContent', html);
    openModal('detailsModal');
}

// ============================================
// EXPORTAR / IMPORTAR / BORRAR
// ============================================

function exportData() {
    data.lastBackup = new Date().toISOString();
    saveData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finanzas_backup_${todayISO()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupBannerDismissed = false;
    renderBanners();
    if (currentSection === 'datos') renderSettings();
    showNotification('Backup descargado', 'success');
}

function importData() {
    const file = $('importFile').files[0];
    if (!file) { showNotification('Selecciona un archivo', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported.transactions)) throw new Error('Archivo inválido');
            if (!confirm(`¿Reemplazar tus datos actuales por este backup (${imported.transactions.length} movimientos)?`)) return;
            data = normalizeData(imported).normalized;
            saveData();
            location.reload();
        } catch (err) {
            showNotification('Error: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

function resetData() {
    if (prompt('Esto borra TODO. Haz un backup antes.\nEscribe "BORRAR TODO" para confirmar:') === 'BORRAR TODO') {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}
