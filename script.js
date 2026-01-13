// ============================================
// ESTRUCTURA DE DATOS
// ============================================

let data = {
    setupComplete: false,
    emergencyGoal: 5000,
    categoryGroups: {
        basicos: { name: 'Gastos Básicos', percent: 20, categories: ['Salud', 'Transporte'] },
        ocio: { name: 'Ocio', percent: 15, categories: ['Comida', 'Hobby', 'Suscripciones', 'Ocio', 'Otros'] },
        inversion: { name: 'Inversión', percent: 65, categories: ['Colchón', 'ETFs', 'Acciones', 'Fondos'] }
    },
    transactions: []
};

let evolutionChart = null, distributionChart = null;
let chartState = { isYearly: false, currentMonth: null, currentYear: null };
let distributionState = { currentMonth: null };

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    loadData();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    chartState.currentMonth = currentMonth;
    chartState.currentYear = now.getFullYear();
    distributionState.currentMonth = currentMonth;
    
    const monthInput = document.getElementById('transactionMonth');
    if (monthInput) monthInput.value = currentMonth;
    
    updateMonthFilters();
    
    if (!data.setupComplete) {
        showSection('inversiones');
        document.getElementById('investmentSetup').style.display = 'block';
        document.getElementById('investmentPanel').style.display = 'none';
    } else {
        updateDashboard();
        renderInvestmentPanel();
    }
});

// ============================================
// GESTIÓN DE DATOS
// ============================================

function loadData() {
    const stored = localStorage.getItem('financeManagerData');
    if (stored) {
        const loaded = JSON.parse(stored);
        if (!loaded.categoryGroups) loaded.categoryGroups = data.categoryGroups;
        if (!loaded.categoryGroups.inversion) {
            loaded.categoryGroups.inversion = { name: 'Inversión', percent: 65, categories: ['Colchón', 'ETFs', 'Acciones', 'Fondos'] };
        }
        if (loaded.emergencyGoal === undefined) loaded.emergencyGoal = 5000;
        if (!loaded.transactions) loaded.transactions = [];
        data = loaded;
    }
}

function saveData() {
    localStorage.setItem('financeManagerData', JSON.stringify(data));
}

// ============================================
// HELPERS
// ============================================

function getAllCategories() {
    const cats = [];
    Object.values(data.categoryGroups).forEach(g => cats.push(...g.categories));
    return cats;
}

function isInvestmentCategory(category) {
    return data.categoryGroups.inversion.categories.includes(category);
}

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getCurrentYear() {
    return new Date().getFullYear();
}

function formatCurrency(amount) {
    return (amount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€';
}

function formatMonth(monthStr) {
    return new Date(monthStr + '-01').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

// ============================================
// CÁLCULOS FINANCIEROS CORREGIDOS
// ============================================

// Total invertido = suma de "gastos" tipo inversión
function getTotalInvested() {
    return data.transactions
        .filter(t => t.type === 'expense' && isInvestmentCategory(t.category))
        .reduce((sum, t) => sum + t.amount, 0);
}

// Colchón = gastos con categoría "Colchón"
function getEmergencyFundTotal() {
    return data.transactions
        .filter(t => t.type === 'expense' && t.category === 'Colchón')
        .reduce((sum, t) => sum + t.amount, 0);
}

// Inversión por categoría
function getInvestmentByCategory() {
    const breakdown = {};
    data.transactions
        .filter(t => t.type === 'expense' && isInvestmentCategory(t.category))
        .forEach(t => { breakdown[t.category] = (breakdown[t.category] || 0) + t.amount; });
    return breakdown;
}

// PATRIMONIO = Ingresos - Gastos REALES (inversiones NO restan)
function getPatrimony() {
    const totalIncome = data.transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const realExpenses = data.transactions.filter(t => t.type === 'expense' && !isInvestmentCategory(t.category)).reduce((sum, t) => sum + t.amount, 0);
    return totalIncome - realExpenses;
}

// DISPONIBLE = Patrimonio - Invertido
function getAvailable() {
    return getPatrimony() - getTotalInvested();
}

// ============================================
// NAVEGACIÓN
// ============================================

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.textContent.toLowerCase().includes(sectionId.substring(0, 4))) btn.classList.add('active');
    });
    
    if (sectionId === 'dashboard') updateDashboard();
    if (sectionId === 'inversiones') renderInvestmentPanel();
    if (sectionId === 'estadisticas') updateStats();
}

// ============================================
// CONFIGURACIÓN INICIAL
// ============================================

function completeSetup() {
    const emergencyGoal = parseFloat(document.getElementById('setupEmergencyGoal').value);
    if (!emergencyGoal || emergencyGoal <= 0) { showNotification('Ingresa una meta válida', 'warning'); return; }
    
    data.emergencyGoal = emergencyGoal;
    data.setupComplete = true;
    saveData();
    
    document.getElementById('investmentSetup').style.display = 'none';
    document.getElementById('investmentPanel').style.display = 'block';
    renderInvestmentPanel();
    showNotification('Configuración completada', 'success');
}

// ============================================
// DASHBOARD
// ============================================

function updateDashboard() {
    updateSummaryCards();
    updateExpensesList();
    updateIncomesList();
}

function updateSummaryCards() {
    const currentMonth = getCurrentMonth();
    
    const monthlyIncome = data.transactions.filter(t => t.type === 'income' && t.month === currentMonth).reduce((sum, t) => sum + t.amount, 0);
    const monthlyExpenses = data.transactions.filter(t => t.type === 'expense' && t.month === currentMonth && !isInvestmentCategory(t.category)).reduce((sum, t) => sum + t.amount, 0);
    
    const totalIncome = data.transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const realExpenses = data.transactions.filter(t => t.type === 'expense' && !isInvestmentCategory(t.category)).reduce((sum, t) => sum + t.amount, 0);
    const savingsRate = totalIncome > 0 ? (((totalIncome - realExpenses) / totalIncome) * 100).toFixed(1) : 0;
    
    document.getElementById('monthlyIncome').textContent = formatCurrency(monthlyIncome);
    document.getElementById('monthlyExpenses').textContent = formatCurrency(monthlyExpenses);
    document.getElementById('savingsRate').textContent = savingsRate + '%';
    document.getElementById('totalPatrimony').textContent = formatCurrency(getPatrimony());
}

function updateExpensesList() {
    const filterMonth = document.getElementById('filterExpensesMonth')?.value || '';
    const container = document.getElementById('expensesList');
    
    let expenses = data.transactions.filter(t => t.type === 'expense' && !isInvestmentCategory(t.category));
    if (filterMonth) expenses = expenses.filter(t => t.month === filterMonth);
    expenses.sort((a, b) => b.month.localeCompare(a.month) || new Date(b.date) - new Date(a.date));
    
    document.getElementById('expensesTotal').textContent = formatCurrency(expenses.reduce((sum, t) => sum + t.amount, 0));
    
    if (expenses.length === 0) { container.innerHTML = '<p class="empty-message">No hay gastos</p>'; return; }
    
    container.innerHTML = expenses.map(t => `
        <div class="transaction-item" onclick="openEditTransaction(${t.id})">
            <div class="transaction-row">
                <span class="transaction-category">${t.category}</span>
                <span class="transaction-amount negative">-${formatCurrency(t.amount)}</span>
            </div>
            <div class="transaction-meta"><span>🏦 ${t.account || 'Efectivo'}</span><span>${formatMonth(t.month)}</span></div>
            ${t.description ? `<div class="transaction-description">${t.description}</div>` : ''}
        </div>
    `).join('');
}

function updateIncomesList() {
    const filterMonth = document.getElementById('filterIncomesMonth')?.value || '';
    const container = document.getElementById('incomesList');
    
    let incomes = data.transactions.filter(t => t.type === 'income');
    if (filterMonth) incomes = incomes.filter(t => t.month === filterMonth);
    incomes.sort((a, b) => b.month.localeCompare(a.month) || new Date(b.date) - new Date(a.date));
    
    document.getElementById('incomesTotal').textContent = formatCurrency(incomes.reduce((sum, t) => sum + t.amount, 0));
    
    if (incomes.length === 0) { container.innerHTML = '<p class="empty-message">No hay ingresos</p>'; return; }
    
    container.innerHTML = incomes.map(t => `
        <div class="transaction-item" onclick="openEditTransaction(${t.id})">
            <div class="transaction-row">
                <span class="transaction-category">${t.category}</span>
                <span class="transaction-amount positive">+${formatCurrency(t.amount)}</span>
            </div>
            <div class="transaction-meta"><span>🏦 ${t.account || 'Efectivo'}</span><span>${formatMonth(t.month)}</span></div>
            ${t.description ? `<div class="transaction-description">${t.description}</div>` : ''}
        </div>
    `).join('');
}

function updateMonthFilters() {
    const months = [...new Set(data.transactions.filter(t => t.type === 'income' || (t.type === 'expense' && !isInvestmentCategory(t.category))).map(t => t.month))].sort().reverse();
    const currentMonth = getCurrentMonth();
    const html = '<option value="">Todos</option>' + months.map(m => `<option value="${m}">${formatMonth(m)}</option>`).join('');
    
    ['filterExpensesMonth', 'filterIncomesMonth'].forEach(id => {
        const select = document.getElementById(id);
        if (select) { select.innerHTML = html; if (months.includes(currentMonth)) select.value = currentMonth; }
    });
}

function filterExpenses() { updateExpensesList(); }
function filterIncomes() { updateIncomesList(); }

// ============================================
// TRANSACCIONES
// ============================================

function openAddTransaction(type) {
    document.getElementById('transactionType').value = type;
    document.getElementById('transactionModalTitle').textContent = type === 'income' ? 'Nuevo Ingreso' : 'Nuevo Gasto';
    document.getElementById('transactionAmount').value = '';
    document.getElementById('transactionDescription').value = '';
    document.getElementById('transactionMonth').value = getCurrentMonth();
    
    const categorySelect = document.getElementById('transactionCategory');
    if (type === 'income') {
        categorySelect.innerHTML = '<option value="Salario">Salario</option><option value="Servicio">Servicio</option><option value="Otros">Otros</option>';
    } else {
        let html = '';
        for (const [key, group] of Object.entries(data.categoryGroups)) {
            html += `<optgroup label="${group.name}">${group.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}</optgroup>`;
        }
        categorySelect.innerHTML = html;
    }
    openModal('addTransactionModal');
}

function saveTransaction() {
    const type = document.getElementById('transactionType').value;
    const month = document.getElementById('transactionMonth').value;
    const amount = parseFloat(document.getElementById('transactionAmount').value);
    const category = document.getElementById('transactionCategory').value;
    const account = document.getElementById('transactionAccount').value;
    const description = document.getElementById('transactionDescription').value.trim();
    
    if (!month || !amount || amount <= 0) { showNotification('Completa todos los campos', 'warning'); return; }
    
    data.transactions.push({ id: Date.now(), type, month, amount, category, account, description, date: new Date().toISOString() });
    saveData();
    closeModal('addTransactionModal');
    updateMonthFilters();
    updateDashboard();
    if (document.getElementById('inversiones').classList.contains('active')) renderInvestmentPanel();
    showNotification('Transacción guardada', 'success');
}

function openEditTransaction(id) {
    const t = data.transactions.find(t => t.id === id);
    if (!t) return;
    
    document.getElementById('editTransactionId').value = t.id;
    document.getElementById('editAmount').value = t.amount;
    document.getElementById('editAccount').value = t.account || 'Efectivo';
    document.getElementById('editDescription').value = t.description || '';
    
    const categorySelect = document.getElementById('editCategory');
    if (t.type === 'income') {
        categorySelect.innerHTML = '<option value="Salario">Salario</option><option value="Servicio">Servicio</option><option value="Otros">Otros</option>';
    } else {
        let html = '';
        for (const [key, group] of Object.entries(data.categoryGroups)) {
            html += `<optgroup label="${group.name}">${group.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}</optgroup>`;
        }
        categorySelect.innerHTML = html;
    }
    categorySelect.value = t.category;
    openModal('editTransactionModal');
}

function saveEditedTransaction() {
    const id = parseInt(document.getElementById('editTransactionId').value);
    const t = data.transactions.find(t => t.id === id);
    if (!t) return;
    
    t.amount = parseFloat(document.getElementById('editAmount').value);
    t.category = document.getElementById('editCategory').value;
    t.account = document.getElementById('editAccount').value;
    t.description = document.getElementById('editDescription').value.trim();
    
    saveData();
    closeModal('editTransactionModal');
    updateDashboard();
    renderInvestmentPanel();
    showNotification('Actualizada', 'success');
}

function deleteTransaction() {
    if (!confirm('¿Eliminar?')) return;
    const id = parseInt(document.getElementById('editTransactionId').value);
    data.transactions = data.transactions.filter(t => t.id !== id);
    saveData();
    closeModal('editTransactionModal');
    updateMonthFilters();
    updateDashboard();
    renderInvestmentPanel();
    showNotification('Eliminada', 'success');
}

// ============================================
// INVERSIONES
// ============================================

function renderInvestmentPanel() {
    if (!data.setupComplete) return;
    updateInvestmentSummary();
    renderBubbleChart();
    renderExpenseCategories();
}

function updateInvestmentSummary() {
    const emergencyReal = getEmergencyFundTotal();
    const emergencyGoal = data.emergencyGoal || 5000;
    const emergencyPercent = Math.min((emergencyReal / emergencyGoal) * 100, 100);
    
    document.getElementById('emergencyCurrentText').textContent = formatCurrency(emergencyReal);
    document.getElementById('emergencyGoalText').textContent = formatCurrency(emergencyGoal);
    document.getElementById('emergencyBarFill').style.width = emergencyPercent + '%';
    document.getElementById('emergencyPercentBig').textContent = emergencyPercent.toFixed(0) + '%';
    document.getElementById('emergencyCompleteMsg').style.display = emergencyReal >= emergencyGoal ? 'block' : 'none';
    
    const totalInvested = getTotalInvested();
    document.getElementById('invTotalInvested').textContent = formatCurrency(totalInvested);
    
    const breakdown = getInvestmentByCategory();
    const distributionDiv = document.getElementById('investmentDistribution');
    if (Object.keys(breakdown).length > 0 && totalInvested > 0) {
        distributionDiv.innerHTML = Object.entries(breakdown).map(([cat, amount]) => 
            `<div class="distribution-item"><span>${cat}</span><span>${((amount / totalInvested) * 100).toFixed(0)}%</span></div>`
        ).join('');
    } else {
        distributionDiv.innerHTML = '<small>Sin inversiones</small>';
    }
    
    document.getElementById('availableThisMonth').textContent = formatCurrency(getAvailable());
    document.getElementById('availableBreakdown').textContent = `Patrimonio (${formatCurrency(getPatrimony())}) - Invertido (${formatCurrency(totalInvested)})`;
}

function editEmergencyGoal() {
    openEditModal('Meta Colchón', data.emergencyGoal, (value) => {
        if (value > 0) { data.emergencyGoal = value; saveData(); updateInvestmentSummary(); showNotification('Meta actualizada', 'success'); }
    });
}

// ============================================
// BURBUJAS
// ============================================

function renderBubbleChart() {
    const container = document.getElementById('investmentBubbles');
    const breakdown = getInvestmentByCategory();
    
    if (Object.keys(breakdown).length === 0) {
        container.innerHTML = '<div class="empty-bubbles"><p>No hay inversiones</p><p class="empty-hint">Añade gastos en "Inversión"</p></div>';
        return;
    }
    
    const maxAmount = Math.max(...Object.values(breakdown));
    const colors = ['#4a5c4a', '#6b8e6b', '#8fb88f', '#3a4a3a', '#5a6c5a', '#7a9e7a', '#4a90a4'];
    
    let i = 0;
    container.innerHTML = Object.entries(breakdown).map(([cat, amount]) => {
        const size = 80 + ((amount / maxAmount) * 80);
        return `<div class="bubble" style="width:${size}px;height:${size}px;background:${colors[i++ % colors.length]}" title="${cat}: ${formatCurrency(amount)}">
            <span class="bubble-name">${cat}</span><span class="bubble-amount">${formatCurrency(amount)}</span>
        </div>`;
    }).join('');
}

// ============================================
// CATEGORÍAS
// ============================================

function renderExpenseCategories() {
    const container = document.getElementById('expenseCategoriesList');
    let html = '';
    for (const [key, group] of Object.entries(data.categoryGroups)) {
        html += `<div class="category-group">
            <div class="category-group-header" onclick="toggleCategoryGroup('${key}')">
                <span class="category-group-title">${group.name}</span><span class="category-group-percent">${group.percent}%</span>
            </div>
            <div class="category-tags" id="group-${key}">
                ${group.categories.map((cat, i) => `<span class="category-tag">${cat}<span class="category-remove" onclick="event.stopPropagation();removeExpenseCategory('${key}',${i})">×</span></span>`).join('')}
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

function toggleCategoryGroup(key) {
    const el = document.getElementById('group-' + key);
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

function addExpenseCategory() {
    document.getElementById('newCategoryName').value = '';
    document.getElementById('newCategoryGroup').value = 'ocio';
    openModal('newCategoryModal');
}

function saveNewCategory() {
    const name = document.getElementById('newCategoryName').value.trim();
    const groupKey = document.getElementById('newCategoryGroup').value;
    if (!name) { showNotification('Ingresa nombre', 'warning'); return; }
    if (getAllCategories().includes(name)) { showNotification('Ya existe', 'warning'); return; }
    data.categoryGroups[groupKey].categories.push(name);
    saveData();
    closeModal('newCategoryModal');
    renderExpenseCategories();
    showNotification('Añadida', 'success');
}

function removeExpenseCategory(groupKey, index) {
    const cat = data.categoryGroups[groupKey].categories[index];
    if (!confirm(`¿Eliminar "${cat}"?`)) return;
    data.categoryGroups[groupKey].categories.splice(index, 1);
    saveData();
    renderExpenseCategories();
    showNotification('Eliminada', 'success');
}

// ============================================
// ESTADÍSTICAS
// ============================================

function updateStats() {
    updateDistributionCard();
    updateEvolutionChart();
    updateDistributionChartLabels();
    updateDistributionChart();
}

function updateDistributionCard() {
    const month = distributionState.currentMonth;
    document.getElementById('distributionMonthLabel').textContent = formatMonth(month);
    
    const monthIncome = data.transactions.filter(t => t.type === 'income' && t.month === month).reduce((sum, t) => sum + t.amount, 0);
    document.getElementById('distMonthIncome').textContent = formatCurrency(monthIncome);
    
    const monthExpenses = data.transactions.filter(t => t.type === 'expense' && t.month === month);
    let html = '';
    
    for (const [key, group] of Object.entries(data.categoryGroups)) {
        const target = monthIncome * (group.percent / 100);
        const spent = monthExpenses.filter(t => group.categories.includes(t.category)).reduce((sum, t) => sum + t.amount, 0);
        const percent = target > 0 ? (spent / target) * 100 : 0;
        const isOver = spent > target;
        const diff = Math.abs(target - spent);
        
        html += `<div class="distribution-group">
            <div class="distribution-group-header"><span class="distribution-group-title">${group.name} (${group.percent}%)</span><span class="distribution-group-target">${formatCurrency(target)}</span></div>
            <div class="distribution-progress"><div class="progress-bar-container"><div class="progress-bar-fill ${isOver ? 'over' : 'under'}" style="width:${Math.min(percent, 100)}%"></div></div></div>
            <div class="distribution-stats"><span>${formatCurrency(spent)} ${key === 'inversion' ? 'movidos' : 'gastados'}</span><span class="distribution-status ${isOver ? 'negative' : 'positive'}">${isOver ? '¡Pasado ' + formatCurrency(diff) + '!' : 'Faltan ' + formatCurrency(diff)}</span></div>
        </div>`;
    }
    document.getElementById('distributionGroups').innerHTML = html;
}

function changeDistributionMonth(delta) {
    const [year, month] = distributionState.currentMonth.split('-').map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    distributionState.currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    updateDistributionCard();
}

function editDistributionConfig() {
    let html = '';
    for (const [key, group] of Object.entries(data.categoryGroups)) {
        html += `<div class="form-group"><label>${group.name}</label><input type="number" id="config-${key}" value="${group.percent}" min="0" max="100"></div>`;
    }
    document.getElementById('distributionConfigList').innerHTML = html;
    openModal('distributionConfigModal');
}

function saveDistributionConfig() {
    let total = 0;
    for (const key of Object.keys(data.categoryGroups)) {
        const val = parseInt(document.getElementById('config-' + key).value) || 0;
        data.categoryGroups[key].percent = val;
        total += val;
    }
    if (total !== 100) { showNotification(`Suman ${total}%, deben ser 100%`, 'warning'); return; }
    saveData();
    closeModal('distributionConfigModal');
    updateDistributionCard();
    renderExpenseCategories();
    showNotification('Guardado', 'success');
}

// ============================================
// GRÁFICAS
// ============================================

function updateEvolutionChart() {
    const ctx = document.getElementById('evolutionChart');
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    
    const incomeData = months.map(m => data.transactions.filter(t => t.type === 'income' && t.month === m).reduce((sum, t) => sum + t.amount, 0));
    const expenseData = months.map(m => data.transactions.filter(t => t.type === 'expense' && t.month === m && !isInvestmentCategory(t.category)).reduce((sum, t) => sum + t.amount, 0));
    const labels = months.map(m => new Date(m + '-01').toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }));
    
    if (evolutionChart) evolutionChart.destroy();
    evolutionChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [
            { label: 'Ingresos', data: incomeData, borderColor: '#6b8e6b', backgroundColor: 'rgba(107,142,107,0.1)', tension: 0.4, fill: true },
            { label: 'Gastos', data: expenseData, borderColor: '#8b4a4a', backgroundColor: 'rgba(139,74,74,0.1)', tension: 0.4, fill: true }
        ]},
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e8e8e8' } } }, scales: { y: { beginAtZero: true, ticks: { color: '#b8b8b8' }, grid: { color: '#333' } }, x: { ticks: { color: '#b8b8b8' }, grid: { color: '#333' } } } }
    });
}

function updateDistributionChartLabels() {
    document.getElementById('chartPeriodLabel').textContent = chartState.isYearly ? chartState.currentYear : formatMonth(chartState.currentMonth);
    document.getElementById('toggleChartView').textContent = chartState.isYearly ? 'Ver Mensual' : 'Ver Anual';
    document.getElementById('distributionChartTitle').textContent = chartState.isYearly ? 'Gastos ' + chartState.currentYear : 'Gastos ' + formatMonth(chartState.currentMonth);
}

function updateDistributionChart() {
    const ctx = document.getElementById('distributionChart');
    let expenses = chartState.isYearly 
        ? data.transactions.filter(t => t.type === 'expense' && t.month.startsWith(chartState.currentYear) && !isInvestmentCategory(t.category))
        : data.transactions.filter(t => t.type === 'expense' && t.month === chartState.currentMonth && !isInvestmentCategory(t.category));
    
    const categoryTotals = {};
    expenses.forEach(t => { categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount; });
    
    if (distributionChart) distributionChart.destroy();
    if (Object.keys(categoryTotals).length === 0) { ctx.parentElement.innerHTML = '<p class="empty-message">Sin gastos</p><canvas id="distributionChart"></canvas>'; return; }
    
    distributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: Object.keys(categoryTotals), datasets: [{ data: Object.values(categoryTotals), backgroundColor: ['#6b8e6b', '#4a90a4', '#a4724a', '#8b6b8e', '#a4904a', '#4a8b8b', '#8e6b6b', '#6b8e8e'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#e8e8e8', padding: 15 } } } }
    });
}

function toggleChartView() { chartState.isYearly = !chartState.isYearly; updateDistributionChartLabels(); updateDistributionChart(); }

function changeChartPeriod(delta) {
    if (chartState.isYearly) { chartState.currentYear += delta; }
    else {
        const [year, month] = chartState.currentMonth.split('-').map(Number);
        const date = new Date(year, month - 1 + delta, 1);
        chartState.currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    updateDistributionChartLabels();
    updateDistributionChart();
}

// ============================================
// CALCULADORAS
// ============================================

function calculateMortgage() {
    const price = parseFloat(document.getElementById('housePrice').value), down = parseFloat(document.getElementById('downPayment').value);
    const rate = parseFloat(document.getElementById('interestRate').value), years = parseInt(document.getElementById('years').value);
    if (!price || !down || !rate || !years) { showNotification('Completa campos', 'warning'); return; }
    const principal = price - down, monthlyRate = (rate / 100) / 12, numPayments = years * 12;
    const monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
    const totalPayment = monthlyPayment * numPayments;
    document.getElementById('mortgageResult').innerHTML = `<strong>Préstamo:</strong> ${formatCurrency(principal)}<br><strong>Pago mensual:</strong> ${formatCurrency(monthlyPayment)}<br><strong>Total:</strong> ${formatCurrency(totalPayment)}<br><strong>Intereses:</strong> ${formatCurrency(totalPayment - principal)}`;
}

function calculateEmergencyFund() {
    const monthly = parseFloat(document.getElementById('calcMonthlyExpenses').value), months = parseInt(document.getElementById('monthsCoverage').value);
    if (!monthly || !months) { showNotification('Completa campos', 'warning'); return; }
    document.getElementById('emergencyFundResult').innerHTML = `<strong>Recomendado:</strong> ${formatCurrency(monthly * months)}<br><small>${months} meses × ${formatCurrency(monthly)}</small>`;
}

function calculateCAGR() {
    const initial = parseFloat(document.getElementById('initialValue').value), final = parseFloat(document.getElementById('finalValue').value), years = parseInt(document.getElementById('cagrYears').value);
    if (!initial || !final || !years) { showNotification('Completa campos', 'warning'); return; }
    document.getElementById('cagrResult').innerHTML = `<strong>CAGR:</strong> ${((Math.pow(final / initial, 1 / years) - 1) * 100).toFixed(2)}%`;
}

function calculateCompoundInterest() {
    const initial = parseFloat(document.getElementById('ciInitial').value), monthly = parseFloat(document.getElementById('ciMonthly').value);
    const rate = parseFloat(document.getElementById('ciRate').value), years = parseInt(document.getElementById('ciYears').value);
    if (!initial || !monthly || !rate || !years) { showNotification('Completa campos', 'warning'); return; }
    const monthlyRate = (rate / 100) / 12, months = years * 12;
    const total = initial * Math.pow(1 + monthlyRate, months) + monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
    const totalInvested = initial + (monthly * months);
    document.getElementById('ciResult').innerHTML = `<strong>Invertido:</strong> ${formatCurrency(totalInvested)}<br><strong>Intereses:</strong> ${formatCurrency(total - totalInvested)}<br><strong>Total:</strong> ${formatCurrency(total)}`;
}

// ============================================
// MODALES
// ============================================

function openModal(id) { document.getElementById(id).classList.add('active'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('active'); document.body.style.overflow = ''; }
window.addEventListener('click', e => { if (e.target.classList.contains('modal')) { e.target.classList.remove('active'); document.body.style.overflow = ''; } });

function openEditModal(title, currentValue, callback) {
    document.getElementById('editValueTitle').textContent = title;
    document.getElementById('editValueInput').value = currentValue;
    window.currentEditCallback = callback;
    openModal('editValueModal');
}

function saveEditValue() {
    const value = parseFloat(document.getElementById('editValueInput').value);
    if (window.currentEditCallback && !isNaN(value)) window.currentEditCallback(value);
    closeModal('editValueModal');
}

function showNotification(message, type = 'info') {
    document.querySelector('.notification')?.remove();
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()">×</button>`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}

// ============================================
// DETALLES POPUP
// ============================================

function showDetailsPopup(type) {
    const title = document.getElementById('detailsTitle'), content = document.getElementById('detailsContent');
    const currentMonth = getCurrentMonth(), currentYear = getCurrentYear();
    
    if (type === 'income') {
        title.textContent = 'Ingresos';
        const m = data.transactions.filter(t => t.type === 'income' && t.month === currentMonth).reduce((s, t) => s + t.amount, 0);
        const y = data.transactions.filter(t => t.type === 'income' && t.month.startsWith(currentYear)).reduce((s, t) => s + t.amount, 0);
        content.innerHTML = `<div class="details-center"><p><strong>Mensual:</strong> <span class="positive">${formatCurrency(m)}</span></p><p><strong>Anual:</strong> <span class="positive">${formatCurrency(y)}</span></p></div>`;
    } else if (type === 'expenses') {
        title.textContent = 'Gastos';
        const me = data.transactions.filter(t => t.type === 'expense' && t.month === currentMonth && !isInvestmentCategory(t.category));
        const m = me.reduce((s, t) => s + t.amount, 0);
        const y = data.transactions.filter(t => t.type === 'expense' && t.month.startsWith(currentYear) && !isInvestmentCategory(t.category)).reduce((s, t) => s + t.amount, 0);
        const bd = {}; me.forEach(t => { bd[t.category] = (bd[t.category] || 0) + t.amount; });
        const bdHtml = Object.keys(bd).length > 0 ? '<div class="details-breakdown">' + Object.entries(bd).sort((a, b) => b[1] - a[1]).map(([c, a]) => `<div class="details-breakdown-item"><span>${c}</span><span class="negative">${formatCurrency(a)}</span></div>`).join('') + '</div>' : '';
        content.innerHTML = `<div class="details-center"><p><strong>Mensual:</strong> <span class="negative">${formatCurrency(m)}</span></p><p><strong>Anual:</strong> <span class="negative">${formatCurrency(y)}</span></p><hr><p style="color:var(--text-muted)">Desglose:</p></div>${bdHtml}`;
    } else if (type === 'savings') {
        title.textContent = 'Tasa de Ahorro';
        const ti = data.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const re = data.transactions.filter(t => t.type === 'expense' && !isInvestmentCategory(t.category)).reduce((s, t) => s + t.amount, 0);
        const rate = ti > 0 ? (((ti - re) / ti) * 100).toFixed(1) : 0;
        content.innerHTML = `<div class="details-center"><h2 class="highlight">${rate}%</h2><p class="details-subtitle">De cada 100€, ahorras ${rate}€</p></div>`;
    } else if (type === 'patrimony') {
        title.textContent = 'Patrimonio';
        const p = getPatrimony(), i = getTotalInvested(), a = getAvailable();
        content.innerHTML = `<div class="details-center"><h2 class="highlight">${formatCurrency(p)}</h2><p class="details-subtitle">Ingresos - Gastos reales</p></div>
            <div class="patrimony-bubbles">
                <div class="patrimony-bubble" style="background:#6b8e6b"><span class="patrimony-bubble-name">Invertido</span><span class="patrimony-bubble-amount">${formatCurrency(i)}</span></div>
                <div class="patrimony-bubble" style="background:${a >= 0 ? '#4a90a4' : '#8b4a4a'}"><span class="patrimony-bubble-name">Disponible</span><span class="patrimony-bubble-amount">${formatCurrency(a)}</span></div>
            </div>`;
    }
    openModal('detailsModal');
}

// ============================================
// GESTIÓN DE DATOS
// ============================================

function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = `finanzas_backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click(); showNotification('Exportado', 'success');
}

function importData() {
    const file = document.getElementById('importFile').files[0];
    if (!file) { showNotification('Selecciona archivo', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported.transactions) throw new Error('Archivo inválido');
            if (confirm('¿Reemplazar datos?')) { data = imported; saveData(); showNotification('Importado', 'success'); location.reload(); }
        } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
}

function resetData() {
    if (prompt('Escribe "BORRAR TODO":') === 'BORRAR TODO') { localStorage.removeItem('financeManagerData'); showNotification('Eliminado', 'success'); location.reload(); }
}