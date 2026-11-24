/**
 * Controle de Presença & Massoterapia — EcoSafety
 * Sincroniza no localStorage + Servidor Local (/api/state)
 */

const STORAGE_KEYS = {
  RECORDS: 'ecosafety_attendance_records_v1',
  SERVICES: 'ecosafety_services_list_v1',
  EVENT_TITLE: 'ecosafety_event_title_v1',
};

const DEFAULT_SERVICES = [
  'Massoterapia',
  'Ventosaterapia',
  'Quick Massage',
  'Liberação Miofascial',
  'Auriculoterapia',
  'Alongamento / Relaxamento',
];

const DEFAULT_SERVICE_SET = new Set(DEFAULT_SERVICES);

const NON_DIGIT_RE = /\D/g;
const AMP_RE = /&/g;
const LT_RE = /</g;
const GT_RE = />/g;
const QUOT_RE = /"/g;
const APOS_RE = /'/g;
const CSV_QUOTE_RE = /"/g;

const storageCache = new Map();
const dateTimeCache = new Map();
const escapeHtmlCache = new Map();

const scheduleIdleWork =
  typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? (cb) => window.requestIdleCallback(cb, { timeout: 1500 })
    : (cb) => setTimeout(cb, 1);

function toSortedArray(arr, compareFn) {
  if (typeof Array.prototype.toSorted === 'function') {
    return arr.toSorted(compareFn);
  }
  return [...arr].sort(compareFn);
}

let didInit = false;
let searchRafId = null;
let idleSaveHandle = null;

let state = {
  eventTitle: 'Lista de Presença — Massoterapia',
  services: [...DEFAULT_SERVICES],
  records: [],
  recordById: new Map(),
  selectedFormServices: new Set(),
  editingId: null,
  quickModalRecordId: null,
  activeMobileView: 'form',
};

const el = {
  eventTitle: document.getElementById('eventTitle'),
  storageStatusText: document.getElementById('storageStatusText'),
  liveDatePill: document.getElementById('liveDatePill'),

  statParticipants: document.getElementById('statParticipants'),
  statServicesTotal: document.getElementById('statServicesTotal'),
  statAvgPerPerson: document.getElementById('statAvgPerPerson'),
  statCompanies: document.getElementById('statCompanies'),
  serviceCounters: document.getElementById('serviceCounters'),

  mobileStatParticipants: document.getElementById('mobileStatParticipants'),
  mobileStatServices: document.getElementById('mobileStatServices'),
  mobileStatCompanies: document.getElementById('mobileStatCompanies'),
  navListBadge: document.getElementById('navListBadge'),
  navTabFormLabel: document.getElementById('navTabFormLabel'),

  viewForm: document.getElementById('viewForm'),
  viewList: document.getElementById('viewList'),
  viewSummary: document.getElementById('viewSummary'),
  navTabs: document.querySelectorAll('.nav-tab'),

  form: document.getElementById('attendanceForm'),
  formHeading: document.getElementById('formHeading'),
  formSubtitle: document.getElementById('formSubtitle'),
  editModeBadge: document.getElementById('editModeBadge'),
  recordId: document.getElementById('recordId'),
  inputName: document.getElementById('inputName'),
  inputPhone: document.getElementById('inputPhone'),
  inputCompany: document.getElementById('inputCompany'),
  companySuggestions: document.getElementById('companySuggestions'),
  quickCompanyChips: document.getElementById('quickCompanyChips'),
  servicesSelector: document.getElementById('servicesSelector'),
  selectedServicesCountHint: document.getElementById('selectedServicesCountHint'),
  inputNewService: document.getElementById('inputNewService'),
  btnAddService: document.getElementById('btnAddService'),
  serviceError: document.getElementById('serviceError'),
  inputNotes: document.getElementById('inputNotes'),
  btnSubmit: document.getElementById('btnSubmit'),
  btnSubmitText: document.getElementById('btnSubmitText'),
  btnCancelEdit: document.getElementById('btnCancelEdit'),

  searchInput: document.getElementById('searchInput'),
  filterService: document.getElementById('filterService'),
  sortOrder: document.getElementById('sortOrder'),
  activeFilterBanner: document.getElementById('activeFilterBanner'),
  activeFilterText: document.getElementById('activeFilterText'),
  btnClearFilters: document.getElementById('btnClearFilters'),
  filteredCountBadge: document.getElementById('filteredCountBadge'),
  mobileCardsList: document.getElementById('mobileCardsList'),
  attendanceTable: document.getElementById('attendanceTable'),
  attendanceTableBody: document.getElementById('attendanceTableBody'),
  emptyState: document.getElementById('emptyState'),
  emptyStateTitle: document.getElementById('emptyStateTitle'),
  emptyStateText: document.getElementById('emptyStateText'),

  btnExportCSVTop: document.getElementById('btnExportCSVTop'),
  btnExportCSVMobile: document.getElementById('btnExportCSVMobile'),
  btnPrint: document.getElementById('btnPrint'),
  btnPrintMobile: document.getElementById('btnPrintMobile'),
  btnBackup: document.getElementById('btnBackup'),
  btnBackupMobile: document.getElementById('btnBackupMobile'),

  quickServiceModal: document.getElementById('quickServiceModal'),
  quickModalPerson: document.getElementById('quickModalPerson'),
  quickModalServices: document.getElementById('quickModalServices'),
  btnCloseQuickModal: document.getElementById('btnCloseQuickModal'),
  btnSaveQuickModal: document.getElementById('btnSaveQuickModal'),

  backupModal: document.getElementById('backupModal'),
  btnCloseBackupModal: document.getElementById('btnCloseBackupModal'),
  btnDownloadJSON: document.getElementById('btnDownloadJSON'),
  inputImportJSON: document.getElementById('inputImportJSON'),
  btnClearAll: document.getElementById('btnClearAll'),

  toastContainer: document.getElementById('toastContainer'),
};

function getCachedStorage(key) {
  if (!storageCache.has(key)) {
    try {
      storageCache.set(key, localStorage.getItem(key));
    } catch {
      storageCache.set(key, null);
    }
  }
  return storageCache.get(key);
}

function setCachedStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    storageCache.set(key, value);
  } catch (err) {
    console.error('Erro ao salvar no localStorage:', err);
  }
}

function minimizeRecord(rec) {
  return {
    id: String(rec.id || ''),
    name: String(rec.name || '').trim(),
    phone: String(rec.phone || '').trim(),
    company: String(rec.company || '').trim(),
    services: Array.isArray(rec.services) ? rec.services : [],
    notes: rec.notes ? String(rec.notes).trim() : '',
    createdAt: rec.createdAt || new Date().toISOString(),
    ...(rec.updatedAt ? { updatedAt: rec.updatedAt } : {}),
  };
}

function rebuildRecordIndex() {
  const map = new Map();
  const records = state.records;
  for (let i = 0, len = records.length; i < len; i++) {
    const rec = minimizeRecord(records[i]);
    records[i] = rec;
    if (rec.id) {
      map.set(rec.id, rec);
    }
  }
  state.recordById = map;
}

function updateLiveDatePill() {
  if (!el.liveDatePill) return;
  const now = new Date();
  el.liveDatePill.textContent = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

async function init() {
  if (didInit) return;
  didInit = true;

  updateLiveDatePill();
  loadStateFromLocalStorage();
  bindEvents();
  renderAll();
  await syncFromServerIfAvailable();
}

function loadStateFromLocalStorage() {
  try {
    const savedTitle = getCachedStorage(STORAGE_KEYS.EVENT_TITLE);
    if (savedTitle) {
      state.eventTitle = savedTitle;
      el.eventTitle.textContent = savedTitle;
    }

    const savedServices = getCachedStorage(STORAGE_KEYS.SERVICES);
    if (savedServices) {
      const parsedServices = JSON.parse(savedServices);
      if (Array.isArray(parsedServices) && parsedServices.length > 0) {
        state.services = parsedServices;
      }
    }

    const savedRecords = getCachedStorage(STORAGE_KEYS.RECORDS);
    if (savedRecords) {
      const parsedRecords = JSON.parse(savedRecords);
      if (Array.isArray(parsedRecords)) {
        state.records = parsedRecords;
        rebuildRecordIndex();
      }
    }
  } catch (err) {
    console.error('Erro ao carregar dados locais:', err);
  }
}

async function syncFromServerIfAvailable() {
  if (window.location.protocol === 'file:') return;
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const serverData = await res.json();
    if (Array.isArray(serverData.records) && serverData.records.length > 0 && state.records.length === 0) {
      state.records = serverData.records;
      rebuildRecordIndex();
      if (Array.isArray(serverData.services) && serverData.services.length > 0) {
        state.services = serverData.services;
      }
      if (serverData.eventTitle) {
        state.eventTitle = serverData.eventTitle;
        el.eventTitle.textContent = serverData.eventTitle;
      }
      saveStateToLocalStorageOnly();
      renderAll();
    } else if (state.records.length > 0) {
      pushStateToServer();
    }
  } catch {
    // Offline mode
  }
}

function saveStateToLocalStorageOnly() {
  setCachedStorage(STORAGE_KEYS.EVENT_TITLE, state.eventTitle);
  setCachedStorage(STORAGE_KEYS.SERVICES, JSON.stringify(state.services));
  setCachedStorage(STORAGE_KEYS.RECORDS, JSON.stringify(state.records.map(minimizeRecord)));
}

async function pushStateToServer() {
  if (window.location.protocol === 'file:') return;
  try {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventTitle: state.eventTitle,
        services: state.services,
        records: state.records,
      }),
    });
  } catch {
    // Offline fallback
  }
}

function saveStateToStorage() {
  if (el.storageStatusText) {
    el.storageStatusText.textContent = 'Salvando...';
  }
  if (idleSaveHandle && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(idleSaveHandle);
  }
  idleSaveHandle = scheduleIdleWork(() => {
    saveStateToLocalStorageOnly();
    pushStateToServer();
    if (el.storageStatusText) {
      el.storageStatusText.textContent = 'Salvo';
    }
  });
}

function switchMobileView(viewName) {
  state.activeMobileView = viewName;

  const views = {
    form: el.viewForm,
    list: el.viewList,
    summary: el.viewSummary,
  };

  Object.entries(views).forEach(([key, section]) => {
    section.classList.toggle('active-mobile-view', key === viewName);
  });

  el.navTabs.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.targetView === viewName);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatPhoneMask(value) {
  const digits = value.replace(NON_DIGIT_RE, '').slice(0, 11);
  const len = digits.length;
  if (len === 0) return '';
  if (len <= 2) return `(${digits}`;
  if (len <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (len <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  if (dateTimeCache.has(isoString)) {
    return dateTimeCache.get(isoString);
  }
  try {
    const date = new Date(isoString);
    const formatted =
      date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }) +
      ' (' +
      date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      }) +
      ')';
    dateTimeCache.set(isoString, formatted);
    return formatted;
  } catch {
    return '';
  }
}

function escapeHTML(str) {
  const raw = String(str || '');
  if (raw.length === 0) return '';
  if (escapeHtmlCache.has(raw)) {
    return escapeHtmlCache.get(raw);
  }
  const escaped = raw
    .replace(AMP_RE, '&amp;')
    .replace(LT_RE, '&lt;')
    .replace(GT_RE, '&gt;')
    .replace(QUOT_RE, '&quot;')
    .replace(APOS_RE, '&#039;');
  if (escapeHtmlCache.size > 2000) {
    escapeHtmlCache.clear();
  }
  escapeHtmlCache.set(raw, escaped);
  return escaped;
}

function renderAll() {
  renderServicesSelector();
  renderStatsAndDerivedLists();
  renderListAndTable();
}

function updateSelectedServicesHint() {
  if (!el.selectedServicesCountHint) return;
  const count = state.selectedFormServices.size;
  if (count === 0) {
    el.selectedServicesCountHint.textContent = 'Nenhum selecionado';
  } else if (count === 1) {
    el.selectedServicesCountHint.textContent = '1 selecionado';
  } else {
    el.selectedServicesCountHint.textContent = `${count} selecionados`;
  }
}

function renderServicesSelector() {
  el.servicesSelector.innerHTML = '';
  updateSelectedServicesHint();

  const fragment = document.createDocumentFragment();

  state.services.forEach((serviceName) => {
    const isSelected = state.selectedFormServices.has(serviceName);
    const isCustom = !DEFAULT_SERVICE_SET.has(serviceName);

    const chip = document.createElement('div');
    chip.className = `service-chip ${isSelected ? 'selected' : ''}`;
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', String(isSelected));
    chip.tabIndex = 0;

    chip.innerHTML = `
      <div class="service-chip-left">
        <span class="service-check">✓</span>
        <span class="service-chip-name">${escapeHTML(serviceName)}</span>
      </div>
      ${
        isCustom
          ? `<button type="button" class="service-remove-btn" data-remove-service="${escapeHTML(
              serviceName
            )}" title="Remover">✕</button>`
          : ''
      }
    `;

    chip.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove-service]');
      if (removeBtn) {
        removeCustomService(removeBtn.dataset.removeService);
        return;
      }
      toggleFormService(serviceName);
    });

    chip.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleFormService(serviceName);
      }
    });

    fragment.appendChild(chip);
  });

  el.servicesSelector.appendChild(fragment);
}

function toggleFormService(serviceName) {
  if (state.selectedFormServices.has(serviceName)) {
    state.selectedFormServices.delete(serviceName);
  } else {
    state.selectedFormServices.add(serviceName);
  }
  el.serviceError.classList.add('hidden');
  renderServicesSelector();
}

function addCustomService() {
  const raw = el.inputNewService.value.trim();
  if (!raw) return;

  const lowerRaw = raw.toLowerCase();
  const existing = state.services.find((s) => s.toLowerCase() === lowerRaw);
  if (existing) {
    state.selectedFormServices.add(existing);
  } else {
    state.services.push(raw);
    state.selectedFormServices.add(raw);
    saveStateToStorage();
  }

  el.inputNewService.value = '';
  el.serviceError.classList.add('hidden');
  renderServicesSelector();
  renderStatsAndDerivedLists();
}

function removeCustomService(serviceName) {
  state.services = state.services.filter((s) => s !== serviceName);
  state.selectedFormServices.delete(serviceName);
  saveStateToStorage();
  renderServicesSelector();
  renderStatsAndDerivedLists();
}

function renderStatsAndDerivedLists() {
  const records = state.records;
  const totalParticipants = records.length;

  let totalProcedures = 0;
  const companyNormSet = new Set();
  const companyCounts = Object.create(null);
  const countsByService = Object.create(null);
  const allServicesInUse = new Set(state.services);

  for (let i = 0; i < totalParticipants; i++) {
    const rec = records[i];
    const comp = rec.company ? rec.company.trim() : '';
    if (comp) {
      companyNormSet.add(comp.toLowerCase());
      companyCounts[comp] = (companyCounts[comp] || 0) + 1;
    }

    const srvs = Array.isArray(rec.services) ? rec.services : [];
    const srvLen = srvs.length;
    totalProcedures += srvLen;
    for (let j = 0; j < srvLen; j++) {
      const s = srvs[j];
      countsByService[s] = (countsByService[s] || 0) + 1;
      allServicesInUse.add(s);
    }
  }

  const uniqueCompaniesCount = companyNormSet.size;
  el.statParticipants.textContent = totalParticipants;
  el.statServicesTotal.textContent = totalProcedures;
  el.statCompanies.textContent = uniqueCompaniesCount;

  if (el.statAvgPerPerson) {
    el.statAvgPerPerson.textContent = '';
  }

  el.mobileStatParticipants.textContent = totalParticipants;
  el.mobileStatServices.textContent = totalProcedures;
  el.mobileStatCompanies.textContent = uniqueCompaniesCount;
  el.navListBadge.textContent = totalParticipants;

  const currentFilterVal = el.filterService.value;
  const servicesArray = Array.from(allServicesInUse);
  el.filterService.innerHTML =
    `<option value="ALL">Todos os procedimentos</option>` +
    servicesArray.map((s) => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');

  el.filterService.value = allServicesInUse.has(currentFilterVal) ? currentFilterVal : 'ALL';

  const companyEntries = Object.entries(companyCounts);
  const sortedCompaniesByAlpha = toSortedArray(
    companyEntries.map(([name]) => name),
    (a, b) => a.localeCompare(b, 'pt-BR')
  );
  el.companySuggestions.innerHTML = sortedCompaniesByAlpha
    .map((comp) => `<option value="${escapeHTML(comp)}"></option>`)
    .join('');

  if (el.quickCompanyChips) {
    const topCompanies = toSortedArray(companyEntries, (a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);
    if (!topCompanies.some((c) => c.toLowerCase() === 'ecosafety')) {
      topCompanies.unshift('EcoSafety');
    }
    const currentInputCompany = (el.inputCompany.value || '').trim().toLowerCase();
    el.quickCompanyChips.innerHTML =
      `<span class="quick-companies-label">Sugestões:</span>` +
      topCompanies
        .slice(0, 4)
        .map((comp) => {
          const isCurrent = currentInputCompany === comp.toLowerCase();
          return `<button type="button" class="quick-company-chip ${
            isCurrent ? 'active-company-chip' : ''
          }" data-quick-company="${escapeHTML(comp)}">${escapeHTML(comp)}</button>`;
        })
        .join('');
  }

  const sortedCounts = toSortedArray(Object.entries(countsByService), (a, b) => b[1] - a[1]);
  const activeFilter = el.filterService.value;

  if (sortedCounts.length === 0) {
    el.serviceCounters.innerHTML = `<span class="empty-counter">Sem procedimentos registrados</span>`;
  } else {
    el.serviceCounters.innerHTML = sortedCounts
      .map(([srv, count]) => {
        const isActive = activeFilter === srv;
        return `
          <button
            type="button"
            class="service-counter-pill ${isActive ? 'active-filter-pill' : ''}"
            data-filter-pill="${escapeHTML(srv)}"
          >
            <span>${escapeHTML(srv)}</span>
            <strong>${count}</strong>
          </button>
        `;
      })
      .join('');
  }
}

function getFilteredAndSortedRecords() {
  const query = el.searchInput.value.trim().toLowerCase();
  const queryDigits = query.replace(NON_DIGIT_RE, '');
  const serviceFilter = el.filterService.value;
  const sort = el.sortOrder.value;

  const filtered = state.records.filter((rec) => {
    const matchesService =
      serviceFilter === 'ALL' || (Array.isArray(rec.services) && rec.services.includes(serviceFilter));
    if (!matchesService) return false;

    if (!query) return true;

    const nameMatch = rec.name && rec.name.toLowerCase().includes(query);
    if (nameMatch) return true;

    const companyMatch = rec.company && rec.company.toLowerCase().includes(query);
    if (companyMatch) return true;

    const phoneMatch =
      (rec.phone && rec.phone.toLowerCase().includes(query)) ||
      (queryDigits.length > 0 && rec.phone && rec.phone.replace(NON_DIGIT_RE, '').includes(queryDigits));
    if (phoneMatch) return true;

    return Boolean(rec.notes && rec.notes.toLowerCase().includes(query));
  });

  return toSortedArray(filtered, (a, b) => {
    if (sort === 'oldest') {
      return new Date(a.createdAt) - new Date(b.createdAt);
    }
    if (sort === 'name') {
      return (a.name || '').localeCompare(b.name || '', 'pt-BR');
    }
    if (sort === 'company') {
      return (a.company || '').localeCompare(b.company || '', 'pt-BR');
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function updateActiveFilterBanner(filteredCount) {
  if (!el.activeFilterBanner || !el.activeFilterText) return;
  const query = el.searchInput.value.trim();
  const serviceFilter = el.filterService.value;
  const hasFilter = Boolean(query) || serviceFilter !== 'ALL';

  if (!hasFilter) {
    el.activeFilterBanner.classList.add('hidden');
    return;
  }

  const parts = [];
  if (serviceFilter !== 'ALL') parts.push(serviceFilter);
  if (query) parts.push(`"${query}"`);

  el.activeFilterText.textContent = `Filtrando por ${parts.join(', ')} (${filteredCount} de ${state.records.length})`;
  el.activeFilterBanner.classList.remove('hidden');
}

function renderListAndTable() {
  const list = getFilteredAndSortedRecords();
  const hasAnyRecords = state.records.length > 0;

  updateActiveFilterBanner(list.length);
  el.filteredCountBadge.textContent = String(list.length);

  if (list.length === 0) {
    el.mobileCardsList.innerHTML = '';
    el.attendanceTable.classList.add('hidden');
    el.emptyState.classList.remove('hidden');

    if (hasAnyRecords) {
      el.emptyStateTitle.textContent = 'Nenhum resultado para o filtro atual';
      el.emptyStateText.textContent = 'Altere os termos da busca ou limpe o filtro de procedimento.';
    } else {
      el.emptyStateTitle.textContent = 'Nenhum participante registrado';
      el.emptyStateText.textContent = 'Utilize o formulário ao lado para registrar o primeiro atendimento.';
    }
    return;
  }

  el.attendanceTable.classList.remove('hidden');
  el.emptyState.classList.add('hidden');

  const mobileCardsHTML = [];
  const tableRowsHTML = [];

  for (let index = 0, len = list.length; index < len; index++) {
    const rec = list[index];
    const cleanDigits = (rec.phone || '').replace(NON_DIGIT_RE, '');
    const waLink = cleanDigits.length >= 10 ? `https://wa.me/55${cleanDigits}` : null;
    const servicesHTML = (rec.services || [])
      .map((s) => `<span class="service-tag">${escapeHTML(s)}</span>`)
      .join('');
    const isEditing = state.editingId === rec.id;
    const formattedTime = formatDateTime(rec.createdAt);

    mobileCardsHTML.push(`
      <article class="participant-card ${isEditing ? 'editing-row' : ''}">
        <div class="p-card-top">
          <div>
            <div>
              <span class="p-card-index">${index + 1}.</span>
              <span class="p-card-name">${escapeHTML(rec.name)}</span>
            </div>
            <div class="p-card-meta">
              <span>${escapeHTML(rec.phone)}</span>
              ${
                waLink
                  ? `<a href="${waLink}" target="_blank" rel="noopener" class="whatsapp-link">WhatsApp</a>`
                  : ''
              }
            </div>
          </div>
          <span class="company-badge">${escapeHTML(rec.company)}</span>
        </div>

        ${rec.notes ? `<div class="p-card-notes">${escapeHTML(rec.notes)}</div>` : ''}

        <div class="p-card-services">
          ${servicesHTML}
          <button type="button" class="btn-quick-service no-print" data-quick-id="${rec.id}">
            + Procedimento
          </button>
        </div>

        <div class="p-card-footer">
          <span class="time-cell">${formattedTime}</span>
          <div class="row-actions no-print">
            <button type="button" class="action-btn" data-edit-id="${rec.id}">Editar</button>
            <button type="button" class="action-btn delete-btn" data-delete-id="${rec.id}">Excluir</button>
          </div>
        </div>
      </article>
    `);

    tableRowsHTML.push(`
      <tr class="${isEditing ? 'editing-row' : ''}">
        <td class="col-index">${index + 1}</td>
        <td class="col-person">
          <span class="person-name">${escapeHTML(rec.name)}</span>
          ${rec.notes ? `<span class="person-notes">${escapeHTML(rec.notes)}</span>` : ''}
        </td>
        <td class="col-phone">
          ${escapeHTML(rec.phone)}
          ${
            waLink
              ? ` <a href="${waLink}" target="_blank" rel="noopener" class="whatsapp-link no-print">WhatsApp</a>`
              : ''
          }
        </td>
        <td class="col-company">
          <span class="company-badge">${escapeHTML(rec.company)}</span>
        </td>
        <td class="col-services">
          <div class="row-services-wrap">
            ${servicesHTML}
            <button
              type="button"
              class="btn-quick-service no-print"
              data-quick-id="${rec.id}"
            >
              +
            </button>
          </div>
        </td>
        <td class="col-time time-cell">${formattedTime}</td>
        <td class="col-actions no-print">
          <div class="row-actions">
            <button type="button" class="action-btn" data-edit-id="${rec.id}">Editar</button>
            <button type="button" class="action-btn delete-btn" data-delete-id="${rec.id}" title="Excluir">✕</button>
          </div>
        </td>
      </tr>
    `);
  }

  el.mobileCardsList.innerHTML = mobileCardsHTML.join('');
  el.attendanceTableBody.innerHTML = tableRowsHTML.join('');
}

function handleFormSubmit(e) {
  e.preventDefault();

  const name = el.inputName.value.trim();
  const phone = el.inputPhone.value.trim();
  const company = el.inputCompany.value.trim();
  const notes = el.inputNotes.value.trim();
  const selectedServices = Array.from(state.selectedFormServices);

  if (!name || !phone || !company) {
    showToast('Preencha nome, telefone e empresa.');
    return;
  }

  if (selectedServices.length === 0) {
    el.serviceError.classList.remove('hidden');
    return;
  }

  const wasEditing = Boolean(state.editingId);

  if (state.editingId) {
    const existing = state.recordById.get(state.editingId);
    if (existing) {
      existing.name = name;
      existing.phone = phone;
      existing.company = company;
      existing.services = selectedServices;
      existing.notes = notes;
      existing.updatedAt = new Date().toISOString();
      showToast(`Registro de ${name} atualizado.`);
    }
  } else {
    const newRecord = minimizeRecord({
      id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name,
      phone,
      company,
      services: selectedServices,
      notes,
      createdAt: new Date().toISOString(),
    });
    state.records.unshift(newRecord);
    state.recordById.set(newRecord.id, newRecord);
    showToast(`Presença de ${name} registrada.`);
  }

  saveStateToStorage();
  resetForm();
  renderAll();

  if (wasEditing && window.innerWidth < 1024) {
    switchMobileView('list');
  }
}

function startEditRecord(id) {
  const rec = state.recordById.get(id);
  if (!rec) return;

  state.editingId = rec.id;
  el.recordId.value = rec.id;
  el.inputName.value = rec.name || '';
  el.inputPhone.value = rec.phone || '';
  el.inputCompany.value = rec.company || '';
  el.inputNotes.value = rec.notes || '';

  state.selectedFormServices = new Set(rec.services || []);

  el.formHeading.textContent = 'Editar registro';
  el.formSubtitle.textContent = rec.name;
  el.editModeBadge.classList.remove('hidden');
  el.btnSubmitText.textContent = 'Salvar alterações';
  el.navTabFormLabel.textContent = 'Editando';
  el.btnCancelEdit.classList.remove('hidden');
  el.serviceError.classList.add('hidden');

  renderServicesSelector();
  renderStatsAndDerivedLists();
  renderListAndTable();

  if (window.innerWidth < 1024) {
    switchMobileView('form');
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function resetForm() {
  state.editingId = null;
  el.recordId.value = '';
  el.form.reset();
  state.selectedFormServices.clear();

  el.formHeading.textContent = 'Novo registro';
  el.formSubtitle.textContent = 'Dados do participante e procedimentos realizados';
  el.editModeBadge.classList.add('hidden');
  el.btnSubmitText.textContent = 'Registrar presença';
  el.navTabFormLabel.textContent = 'Registrar';
  el.btnCancelEdit.classList.add('hidden');
  el.serviceError.classList.add('hidden');

  renderServicesSelector();
  renderListAndTable();
}

function deleteRecord(id) {
  const rec = state.recordById.get(id);
  if (!rec) return;

  if (!confirm(`Excluir o registro de "${rec.name}"?`)) {
    return;
  }

  state.records = state.records.filter((r) => r.id !== id);
  state.recordById.delete(id);

  if (state.editingId === id) {
    resetForm();
  }
  saveStateToStorage();
  renderAll();
  showToast('Registro excluído.');
}

function openQuickServiceModal(id) {
  const rec = state.recordById.get(id);
  if (!rec) return;

  state.quickModalRecordId = id;
  el.quickModalPerson.textContent = `${rec.name} (${rec.company})`;
  renderQuickModalServices(rec);
  el.quickServiceModal.classList.remove('hidden');
}

function renderQuickModalServices(rec) {
  const currentSet = new Set(rec.services || []);
  el.quickModalServices.innerHTML = '';

  const fragment = document.createDocumentFragment();

  state.services.forEach((serviceName) => {
    const isSelected = currentSet.has(serviceName);
    const chip = document.createElement('div');
    chip.className = `service-chip ${isSelected ? 'selected' : ''}`;
    chip.innerHTML = `
      <div class="service-chip-left">
        <span class="service-check">✓</span>
        <span class="service-chip-name">${escapeHTML(serviceName)}</span>
      </div>
    `;
    chip.addEventListener('click', () => {
      if (currentSet.has(serviceName)) {
        if (currentSet.size === 1) {
          showToast('Mantenha ao menos 1 procedimento.');
          return;
        }
        currentSet.delete(serviceName);
      } else {
        currentSet.add(serviceName);
      }
      rec.services = Array.from(currentSet);
      rec.updatedAt = new Date().toISOString();
      saveStateToStorage();
      renderQuickModalServices(rec);
      renderStatsAndDerivedLists();
      renderListAndTable();
    });
    fragment.appendChild(chip);
  });

  el.quickModalServices.appendChild(fragment);
}

function closeQuickServiceModal() {
  state.quickModalRecordId = null;
  el.quickServiceModal.classList.add('hidden');
}

function exportToCSV() {
  if (state.records.length === 0) {
    showToast('Não há registros para exportar.');
    return;
  }

  const headers = [
    'Ordem',
    'Nome Completo',
    'Telefone',
    'Empresa',
    'Procedimentos',
    'Qtd. Procedimentos',
    'Observações',
    'Data e Hora',
  ];

  const escapeCSV = (val) => {
    const str = String(val ?? '').replace(CSV_QUOTE_RE, '""');
    return `"${str}"`;
  };

  const recordsToExport = getFilteredAndSortedRecords();

  const rows = recordsToExport.map((rec, idx) => {
    const dateStr = new Date(rec.createdAt).toLocaleString('pt-BR');
    const servicesList = (rec.services || []).join(', ');
    return [
      idx + 1,
      rec.name,
      rec.phone,
      rec.company,
      servicesList,
      (rec.services || []).length,
      rec.notes || '',
      dateStr,
    ]
      .map(escapeCSV)
      .join(';');
  });

  const csvContent = '\uFEFF' + [headers.map(escapeCSV).join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const dateSlug = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `presenca-ecosafety-${dateSlug}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('Arquivo CSV exportado.');
}

function downloadBackupJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    eventTitle: state.eventTitle,
    services: state.services,
    records: state.records,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateSlug = new Date().toISOString().slice(0, 10);

  const link = document.createElement('a');
  link.href = url;
  link.download = `backup-presenca-ecosafety-${dateSlug}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('Backup salvo.');
}

function importBackupJSON(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.records)) {
        alert('Arquivo de backup inválido.');
        return;
      }

      if (
        state.records.length > 0 &&
        !confirm(
          `Substituir a lista atual (${state.records.length} registros) pelo backup (${data.records.length} registros)?`
        )
      ) {
        return;
      }

      state.records = data.records;
      rebuildRecordIndex();

      if (Array.isArray(data.services) && data.services.length > 0) {
        state.services = data.services;
      }
      if (data.eventTitle) {
        state.eventTitle = data.eventTitle;
        el.eventTitle.textContent = data.eventTitle;
      }

      saveStateToStorage();
      renderAll();
      el.backupModal.classList.add('hidden');
      showToast('Backup restaurado.');
    } catch {
      alert('Erro ao ler o arquivo JSON.');
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  if (state.records.length === 0) {
    showToast('A lista já está vazia.');
    return;
  }

  if (!confirm(`Apagar todos os ${state.records.length} registros?`)) {
    return;
  }

  state.records = [];
  state.recordById.clear();
  resetForm();
  saveStateToStorage();
  renderAll();
  el.backupModal.classList.add('hidden');
  showToast('Registros apagados.');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  el.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2600);
}

function handleListActionClick(e) {
  const quickBtn = e.target.closest('[data-quick-id]');
  if (quickBtn) {
    openQuickServiceModal(quickBtn.dataset.quickId);
    return;
  }

  const editBtn = e.target.closest('[data-edit-id]');
  if (editBtn) {
    startEditRecord(editBtn.dataset.editId);
    return;
  }

  const deleteBtn = e.target.closest('[data-delete-id]');
  if (deleteBtn) {
    deleteRecord(deleteBtn.dataset.deleteId);
  }
}

function bindEvents() {
  window.addEventListener('storage', (e) => {
    if (e.key) {
      storageCache.delete(e.key);
      loadStateFromLocalStorage();
      renderAll();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      storageCache.clear();
      syncFromServerIfAvailable();
    }
  });

  el.navTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMobileView(btn.dataset.targetView);
    });
  });

  el.eventTitle.addEventListener('blur', () => {
    const newTitle = el.eventTitle.textContent.trim() || 'Lista de Presença — Massoterapia';
    state.eventTitle = newTitle;
    el.eventTitle.textContent = newTitle;
    saveStateToStorage();
  });

  el.eventTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.eventTitle.blur();
    }
  });

  el.inputPhone.addEventListener('input', (e) => {
    e.target.value = formatPhoneMask(e.target.value);
  });

  if (el.quickCompanyChips) {
    el.quickCompanyChips.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-quick-company]');
      if (!chip) return;
      el.inputCompany.value = chip.dataset.quickCompany;
      renderStatsAndDerivedLists();
    });
  }

  el.inputCompany.addEventListener('input', () => {
    if (!el.quickCompanyChips) return;
    const val = el.inputCompany.value.trim().toLowerCase();
    el.quickCompanyChips.querySelectorAll('[data-quick-company]').forEach((btn) => {
      btn.classList.toggle('active-company-chip', btn.dataset.quickCompany.toLowerCase() === val);
    });
  });

  el.btnAddService.addEventListener('click', addCustomService);
  el.inputNewService.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomService();
    }
  });

  el.form.addEventListener('submit', handleFormSubmit);
  el.btnCancelEdit.addEventListener('click', () => {
    const wasEditing = Boolean(state.editingId);
    resetForm();
    if (wasEditing && window.innerWidth < 1024) {
      switchMobileView('list');
    }
  });

  el.searchInput.addEventListener('input', () => {
    if (searchRafId) cancelAnimationFrame(searchRafId);
    searchRafId = requestAnimationFrame(() => {
      renderListAndTable();
    });
  });

  el.filterService.addEventListener('change', () => {
    renderStatsAndDerivedLists();
    renderListAndTable();
  });

  el.sortOrder.addEventListener('change', renderListAndTable);

  if (el.btnClearFilters) {
    el.btnClearFilters.addEventListener('click', () => {
      el.searchInput.value = '';
      el.filterService.value = 'ALL';
      renderStatsAndDerivedLists();
      renderListAndTable();
    });
  }

  el.serviceCounters.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-filter-pill]');
    if (!pill) return;
    const srv = pill.dataset.filterPill;
    el.filterService.value = el.filterService.value === srv ? 'ALL' : srv;
    renderStatsAndDerivedLists();
    renderListAndTable();
    if (window.innerWidth < 1024) {
      switchMobileView('list');
    }
  });

  el.mobileCardsList.addEventListener('click', handleListActionClick);
  el.attendanceTableBody.addEventListener('click', handleListActionClick);

  el.btnCloseQuickModal.addEventListener('click', closeQuickServiceModal);
  el.btnSaveQuickModal.addEventListener('click', closeQuickServiceModal);
  el.quickServiceModal.addEventListener('click', (e) => {
    if (e.target === el.quickServiceModal) closeQuickServiceModal();
  });

  el.btnExportCSVTop.addEventListener('click', exportToCSV);
  el.btnExportCSVMobile.addEventListener('click', exportToCSV);
  el.btnPrint.addEventListener('click', () => window.print());
  el.btnPrintMobile.addEventListener('click', () => window.print());
  el.btnBackup.addEventListener('click', () => el.backupModal.classList.remove('hidden'));
  el.btnBackupMobile.addEventListener('click', () => el.backupModal.classList.remove('hidden'));

  el.btnCloseBackupModal.addEventListener('click', () => el.backupModal.classList.add('hidden'));
  el.backupModal.addEventListener('click', (e) => {
    if (e.target === el.backupModal) el.backupModal.classList.add('hidden');
  });
  el.btnDownloadJSON.addEventListener('click', downloadBackupJSON);
  el.inputImportJSON.addEventListener('change', (e) => {
    importBackupJSON(e.target.files[0]);
    e.target.value = '';
  });
  el.btnClearAll.addEventListener('click', clearAllData);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!el.quickServiceModal.classList.contains('hidden')) {
        closeQuickServiceModal();
      } else if (!el.backupModal.classList.contains('hidden')) {
        el.backupModal.classList.add('hidden');
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
