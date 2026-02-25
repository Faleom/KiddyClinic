(() => {
    const state = {
        user: null,
        submissions: [],
        activeTab: 'all',
        loading: true,
    };

    const userEmailEl = document.getElementById('userEmail');
    const refreshBtn = document.getElementById('refreshBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const recordCountEl = document.getElementById('recordCount');
    const alertBoxEl = document.getElementById('alertBox');
    const loadingStateEl = document.getElementById('loadingState');
    const emptyStateEl = document.getElementById('emptyState');
    const contentAreaEl = document.getElementById('contentArea');
    const tabListEl = document.getElementById('tabList');
    const tableBodyEl = document.getElementById('tableBody');

    async function apiFetch(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
            ...options,
        });

        let payload = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            payload = await response.json();
        } else {
            payload = { message: await response.text() };
        }

        if (!response.ok) {
            const message = payload?.error || payload?.message || 'Request failed';
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    function showAlert(type, message) {
        alertBoxEl.className = `alert alert-${type}`;
        alertBoxEl.textContent = message;
        alertBoxEl.classList.remove('d-none');
    }

    function hideAlert() {
        alertBoxEl.classList.add('d-none');
        alertBoxEl.textContent = '';
    }

    function setLoading(loading) {
        state.loading = loading;
        loadingStateEl.classList.toggle('d-none', !loading);
        refreshBtn.disabled = loading;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
    }

    function formatSimpleValue(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    function humanizeKey(key) {
        const normalized = String(key)
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_\-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalized) return 'Field';

        return normalized
            .split(' ')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    function normalizeDisplayValue(value) {
        if (value === true || value === 'true' || value === 'on') return 'Yes';
        if (value === false || value === 'false' || value === 'off') return 'No';
        return formatSimpleValue(value);
    }

    function renderFormData(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return `<span class="text-muted">${escapeHtml(normalizeDisplayValue(data))}</span>`;
        }

        const items = Object.entries(data).map(([key, value]) => {
            const renderedValue = typeof value === 'object'
                ? `<pre class="mb-0 small">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`
                : `<span>${escapeHtml(normalizeDisplayValue(value))}</span>`;

            return `
                <li class="data-item">
                    <span class="data-key">${escapeHtml(humanizeKey(key))}</span>
                    <span class="data-value">${renderedValue}</span>
                </li>
            `;
        });

        if (items.length === 0) {
            return '<span class="text-muted">(empty object)</span>';
        }

        return `<ul class="data-list">${items.join('')}</ul>`;
    }

    function renderPatient(item) {
        const user = item.user || null;
        const profile = user && user.profile && typeof user.profile === 'object' ? user.profile : {};
        const profileItems = Object.entries(profile)
            .map(([key, value]) => `
                <li class="data-item">
                    <span class="data-key">${escapeHtml(humanizeKey(key))}</span>
                    <span class="data-value">${escapeHtml(normalizeDisplayValue(value))}</span>
                </li>
            `)
            .join('');

        if (!item.user_id && !user) {
            return '<span class="text-muted">Guest / Not linked</span>';
        }

        const idText = item.user_id ? `ID: ${escapeHtml(String(item.user_id))}` : 'ID: -';
        const nameText = user?.name ? escapeHtml(user.name) : '<span class="text-muted">Unknown name</span>';
        const emailText = user?.email ? escapeHtml(user.email) : '<span class="text-muted">Unknown email</span>';

        return `
            <div class="patient-block">
                <div class="patient-name">${nameText}</div>
                <div class="patient-meta">${idText}</div>
                <div class="patient-meta">${emailText}</div>
                ${profileItems ? `<ul class="data-list mt-2">${profileItems}</ul>` : ''}
            </div>
        `;
    }

    function escapeHtml(input) {
        return String(input)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getFormTypes() {
        const types = new Set();
        state.submissions.forEach((item) => {
            if (item.form_type) types.add(String(item.form_type));
        });
        return ['all', ...Array.from(types).sort((a, b) => a.localeCompare(b))];
    }

    function getFilteredSubmissions() {
        if (state.activeTab === 'all') {
            return state.submissions;
        }
        return state.submissions.filter((item) => String(item.form_type) === state.activeTab);
    }

    function renderTabs() {
        const tabs = getFormTypes();

        if (!tabs.includes(state.activeTab)) {
            state.activeTab = 'all';
        }

        tabListEl.innerHTML = tabs
            .map((tab) => {
                const isActive = tab === state.activeTab;
                const label = tab === 'all' ? 'All' : tab;
                return `
                    <li class="nav-item me-2 mb-2" role="presentation">
                        <button
                            type="button"
                            class="nav-link ${isActive ? 'active' : ''}"
                            data-tab="${escapeHtml(tab)}"
                            role="tab"
                            aria-selected="${isActive ? 'true' : 'false'}"
                        >
                            ${escapeHtml(label)}
                        </button>
                    </li>
                `;
            })
            .join('');
    }

    function renderTable() {
        const rows = getFilteredSubmissions();

        recordCountEl.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;

        if (rows.length === 0) {
            tableBodyEl.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-4">No submissions in this tab.</td>
                </tr>
            `;
            return;
        }

        tableBodyEl.innerHTML = rows
            .map((item) => {
                return `
                    <tr data-id="${item.id}">
                        <td class="fw-semibold">${item.id}</td>
                        <td><span class="badge text-bg-secondary">${escapeHtml(item.form_type || '-')}</span></td>
                        <td>${escapeHtml(formatDate(item.created_at))}</td>
                        <td>${renderPatient(item)}</td>
                        <td>${renderFormData(item.data)}</td>
                        <td class="text-end">
                            <button type="button" class="btn btn-outline-danger btn-sm btn-delete" data-id="${item.id}">Delete</button>
                        </td>
                    </tr>
                `;
            })
            .join('');
    }

    function render() {
        const hasData = state.submissions.length > 0;

        emptyStateEl.classList.toggle('d-none', state.loading || hasData);
        contentAreaEl.classList.toggle('d-none', state.loading || !hasData);

        if (hasData) {
            renderTabs();
            renderTable();
        } else {
            recordCountEl.textContent = '0 records';
            tabListEl.innerHTML = '';
            tableBodyEl.innerHTML = '';
        }
    }

    async function loadMe() {
        try {
            const me = await apiFetch('/api/me');
            state.user = me.user || null;
            if (!state.user || state.user.role !== 'admin') {
                window.location.href = 'login.html';
                return false;
            }

            userEmailEl.textContent = state.user.email || 'Logged in';
            return true;
        } catch (_error) {
            window.location.href = 'login.html';
            return false;
        }
    }

    async function loadSubmissions() {
        setLoading(true);
        hideAlert();

        try {
            const result = await apiFetch('/api/forms');
            state.submissions = Array.isArray(result.submissions) ? result.submissions : [];
            render();
        } catch (error) {
            state.submissions = [];
            render();
            showAlert('danger', `Failed to load submissions: ${error.message}`);
        } finally {
            setLoading(false);
            render();
        }
    }

    async function handleDelete(id) {
        const confirmed = window.confirm('Are you sure you want to delete this submission?');
        if (!confirmed) return;

        hideAlert();

        try {
            await apiFetch(`/api/forms/${id}`, { method: 'DELETE' });
            state.submissions = state.submissions.filter((item) => Number(item.id) !== Number(id));
            render();
            showAlert('success', `Submission #${id} deleted successfully.`);
        } catch (error) {
            showAlert('danger', `Delete failed: ${error.message}`);
        }
    }

    async function handleLogout() {
        logoutBtn.disabled = true;

        try {
            await apiFetch('/api/logout', { method: 'POST' });
        } catch (_error) {
            // Redirect anyway to clear client-side state.
        } finally {
            window.location.href = 'login.html';
        }
    }

    function bindEvents() {
        refreshBtn.addEventListener('click', () => {
            loadSubmissions();
        });

        logoutBtn.addEventListener('click', () => {
            handleLogout();
        });

        tabListEl.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-tab]');
            if (!btn) return;

            state.activeTab = btn.dataset.tab || 'all';
            render();
        });

        tableBodyEl.addEventListener('click', (event) => {
            const btn = event.target.closest('.btn-delete');
            if (!btn) return;

            const id = btn.dataset.id;
            if (!id) return;
            handleDelete(id);
        });
    }

    async function init() {
        bindEvents();
        const authenticated = await loadMe();
        if (!authenticated) return;
        await loadSubmissions();
    }

    init();
})();
