(() => {
    const state = {
        user: null,
        patients: [],
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
    const tableBodyEl = document.getElementById('tableBody');

    async function apiFetch(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
            ...options,
        });

        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json')
            ? await response.json()
            : { message: await response.text() };

        if (!response.ok) {
            const message = payload?.error || payload?.message || 'Request failed';
            const error = new Error(message);
            error.status = response.status;
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

    function humanizeKey(key) {
        return String(key)
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_\-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    function escapeHtml(input) {
        return String(input)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderProfile(profile) {
        if (!profile || typeof profile !== 'object') {
            return '<span class="text-muted">-</span>';
        }

        const rows = Object.entries(profile);
        if (rows.length === 0) {
            return '<span class="text-muted">-</span>';
        }

        return `<ul class="list-unstyled mb-0 small">${rows
            .map(
                ([key, value]) =>
                    `<li class="border-bottom py-1"><strong>${escapeHtml(humanizeKey(key))}:</strong> ${escapeHtml(String(value))}</li>`
            )
            .join('')}</ul>`;
    }

    function renderTable() {
        if (state.patients.length === 0) {
            tableBodyEl.innerHTML = '';
            return;
        }

        tableBodyEl.innerHTML = state.patients
            .map((patient) => `
                <tr>
                    <td class="fw-semibold">${escapeHtml(String(patient.id))}</td>
                    <td>${escapeHtml(patient.name || '-')}</td>
                    <td>${escapeHtml(patient.email || '-')}</td>
                    <td><span class="badge text-bg-secondary">${escapeHtml(patient.role || 'patient')}</span></td>
                    <td>${escapeHtml(formatDate(patient.created_at))}</td>
                    <td>${escapeHtml(String(patient.submission_count || 0))}</td>
                    <td>${renderProfile(patient.profile)}</td>
                </tr>
            `)
            .join('');
    }

    function render() {
        const hasData = state.patients.length > 0;

        emptyStateEl.classList.toggle('d-none', state.loading || hasData);
        contentAreaEl.classList.toggle('d-none', state.loading || !hasData);
        recordCountEl.textContent = `${state.patients.length} record${state.patients.length === 1 ? '' : 's'}`;

        if (hasData) {
            renderTable();
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

    async function loadPatients() {
        setLoading(true);
        hideAlert();

        try {
            const result = await apiFetch('/api/patients');
            state.patients = Array.isArray(result.patients) ? result.patients : [];
            render();
        } catch (error) {
            state.patients = [];
            render();
            showAlert('danger', `Failed to load patients: ${error.message}`);
        } finally {
            setLoading(false);
            render();
        }
    }

    async function handleLogout() {
        logoutBtn.disabled = true;

        try {
            await apiFetch('/api/logout', { method: 'POST' });
        } catch (_error) {
            // continue redirect
        } finally {
            window.location.href = 'login.html';
        }
    }

    function bindEvents() {
        refreshBtn.addEventListener('click', () => {
            loadPatients();
        });

        logoutBtn.addEventListener('click', () => {
            handleLogout();
        });
    }

    async function init() {
        bindEvents();
        const authenticated = await loadMe();
        if (!authenticated) return;
        await loadPatients();
    }

    init();
})();
