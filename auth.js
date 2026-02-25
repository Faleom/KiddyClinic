(function () {
    const pathName = window.location.pathname.toLowerCase();
    const isDashboardPage = pathName.endsWith('/dashboard.html') || pathName.endsWith('dashboard.html');
    const isLoginPage = pathName.endsWith('/login.html') || pathName.endsWith('login.html');
    const patientVariantPages = new Set([
        'index.html',
        'isoman.html',
        'covid-konsultasi.html',
        'konsultasi-chat.html',
        'konsultasi-meeting.html',
        'konsultasi-onsite.html',
        'obat-resep.html',
        'terimakasih.html',
        'vaksinasi-drive.html',
        'vaksinasi-home.html',
        'vaksinasi-onsite.html',
    ]);

    function escapeHtml(input) {
        return String(input)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function apiFetch(url, options) {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...(options && options.headers ? options.headers : {}),
            },
            ...(options || {}),
        });

        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json')
            ? await response.json()
            : { message: await response.text() };

        if (!response.ok) {
            const error = new Error(payload.error || payload.message || 'Request failed');
            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    function normalizeFormTypeFromPath() {
        const file = getCurrentFileName();
        const withoutExt = file.replace('.html', '');
        const cleaned = withoutExt.replace(/^login-/, '');

        if (cleaned.includes('vaksinasi')) return 'vaccine';
        if (cleaned.includes('covid') || cleaned.includes('isoman')) return 'covid';
        if (cleaned.includes('konsultasi')) return 'consultation';
        if (cleaned.includes('obat')) return 'contact';

        return cleaned || 'general';
    }

    function getCurrentFileName() {
        const raw = pathName.split('/').pop() || '';
        if (!raw) return 'index.html';
        return raw;
    }

    function isPatientProtectedPage() {
        const fileName = getCurrentFileName();
        return fileName.startsWith('login-') && fileName !== 'login.html';
    }

    function toPatientVariant(fileName) {
        if (!fileName || fileName.startsWith('login-') || !fileName.endsWith('.html')) {
            return null;
        }

        if (!patientVariantPages.has(fileName)) {
            return null;
        }

        return `login-${fileName}`;
    }

    function rewriteLinksToPatientVariants() {
        const links = Array.from(document.querySelectorAll('a[href]'));
        links.forEach((link) => {
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#')) return;
            if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) return;

            const match = href.match(/^([^?#]+)([?#].*)?$/);
            if (!match) return;

            const pathPart = match[1];
            const suffix = match[2] || '';

            const segments = pathPart.split('/');
            const fileName = (segments.pop() || '').toLowerCase();
            const variant = toPatientVariant(fileName);

            if (!variant) return;

            segments.push(variant);
            link.setAttribute('href', `${segments.join('/')}${suffix}`);
        });
    }

    function redirectPatientToVariantPage() {
        const fileName = getCurrentFileName();
        const variant = toPatientVariant(fileName);
        if (!variant) return false;

        window.location.replace(variant);
        return true;
    }

    function normalizeFieldKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function getFieldLabelFromContext(element) {
        const inputBox = element.closest('.input-box');
        if (inputBox) {
            const details = inputBox.querySelector('span.details');
            if (details && details.textContent) {
                return details.textContent.trim();
            }
        }

        if (element.id) {
            const linkedLabel = document.querySelector(`label[for="${element.id}"]`);
            if (linkedLabel && linkedLabel.textContent) {
                return linkedLabel.textContent.trim();
            }
        }

        return '';
    }

    function isGenericId(idValue) {
        return /^exampleformcontrolselect\d*$/i.test(String(idValue || '').trim());
    }

    function getInputKey(element, index) {
        const contextualLabel = getFieldLabelFromContext(element);
        if (contextualLabel) return normalizeFieldKey(contextualLabel);

        if (element.name && String(element.name).trim()) {
            return normalizeFieldKey(element.name);
        }

        if (element.placeholder && String(element.placeholder).trim()) {
            return normalizeFieldKey(element.placeholder);
        }

        if (element.id && String(element.id).trim() && !isGenericId(element.id)) {
            return normalizeFieldKey(element.id);
        }

        return `field_${index}`;
    }

    function collectFormAsJson(form) {
        const payload = {};
        const elements = Array.from(form.elements || []);

        elements.forEach((element, index) => {
            if (!element || !element.tagName) return;

            const tag = element.tagName.toLowerCase();
            if (!['input', 'select', 'textarea'].includes(tag)) return;

            const type = (element.type || '').toLowerCase();
            if (['submit', 'button', 'reset', 'file'].includes(type)) return;

            const key = getInputKey(element, index);

            if (type === 'checkbox') {
                payload[key] = Boolean(element.checked);
                return;
            }

            if (type === 'radio') {
                if (!element.checked) return;
            }

            if (payload[key] === undefined) {
                payload[key] = element.value;
                return;
            }

            if (!Array.isArray(payload[key])) {
                payload[key] = [payload[key]];
            }
            payload[key].push(element.value);
        });

        return payload;
    }

    function setupLogoutButton() {
        document.querySelectorAll('[data-auth-logout]').forEach((button) => {
            button.addEventListener('click', async function () {
                try {
                    await apiFetch('/api/logout', { method: 'POST' });
                } catch (_err) {
                    // ignore logout errors and continue redirect
                } finally {
                    window.location.href = 'login.html';
                }
            });
        });
    }

    function injectWelcome(user) {
        const header = document.querySelector('.header, .navbar .container, .navbar .container-fluid, nav');
        if (!header || document.querySelector('.auth-welcome')) return;

        const welcome = document.createElement('span');
        welcome.className = 'auth-welcome badge badge-light ms-2';
        welcome.style.alignSelf = 'center';
        welcome.innerHTML = `Welcome, ${escapeHtml(user.name || 'User')}`;
        header.appendChild(welcome);
    }

    function toggleLoginUiForAuthenticated(user) {
        const loginLinks = Array.from(document.querySelectorAll('a[href="login.html"]'));
        loginLinks.forEach((link) => {
            link.style.display = 'none';

            if (link.parentElement && !link.parentElement.querySelector('[data-auth-logout]')) {
                const logoutBtn = document.createElement('button');
                logoutBtn.type = 'button';
                logoutBtn.className = 'btn btn-outline-danger font-weight-bold p-2';
                logoutBtn.setAttribute('data-auth-logout', '1');
                logoutBtn.textContent = 'Logout';
                link.parentElement.appendChild(logoutBtn);
            }
        });

        setupLogoutButton();
        injectWelcome(user);
    }

    function autoFillPatientData(user) {
        const forms = Array.from(document.querySelectorAll('form'));
        forms.forEach((form) => {
            const action = (form.getAttribute('action') || '').toLowerCase();
            if (action.includes('login-index.html')) return;

            const elements = Array.from(form.elements || []);
            elements.forEach((el) => {
                if (!el || !el.tagName || el.disabled || el.readOnly) return;
                const tag = el.tagName.toLowerCase();
                if (!['input', 'textarea', 'select'].includes(tag)) return;

                const type = (el.type || '').toLowerCase();
                if (['password', 'submit', 'button', 'reset'].includes(type)) return;

                const descriptor = [el.name, el.id, el.placeholder].filter(Boolean).join(' ').toLowerCase();

                if (!el.value && (type === 'email' || descriptor.includes('email'))) {
                    el.value = user.email || '';
                }

                if (!el.value && (descriptor.includes('nama') || descriptor.includes('name'))) {
                    el.value = user.name || '';
                }
            });
        });
    }

    function wireUniversalFormSubmission() {
        const forms = Array.from(document.querySelectorAll('form'));
        forms.forEach((form) => {
            const action = (form.getAttribute('action') || '').toLowerCase();
            if (!action || action.includes('login-index.html')) return;
            if (form.hasAttribute('data-auth-wired')) return;

            form.setAttribute('data-auth-wired', '1');

            form.addEventListener('submit', async function (event) {
                event.preventDefault();

                const payload = collectFormAsJson(form);
                const formType = normalizeFormTypeFromPath();

                try {
                    await apiFetch(`/api/forms/${encodeURIComponent(formType)}`, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                    });

                    const nextPage = form.getAttribute('action');
                    if (nextPage) {
                        window.location.href = nextPage;
                    }
                } catch (err) {
                    alert(`Failed to submit form: ${err.message}`);
                }
            });
        });
    }

    function extractBySelector(form, selector) {
        const el = form.querySelector(selector);
        return el ? String(el.value || '').trim() : '';
    }

    function submitFormNatively(form) {
        if (!form) return;
        form.dataset.nativeSubmit = '1';
        HTMLFormElement.prototype.submit.call(form);
    }

    function sanitizeProfileData(raw) {
        const cleaned = {};
        Object.entries(raw || {}).forEach(([key, value]) => {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return;
            if (['password', 'ulangi_password', 'repeat_password'].includes(normalizedKey.toLowerCase())) return;
            if (value === null || value === undefined) return;
            const text = String(value).trim();
            if (!text) return;
            cleaned[normalizedKey] = text;
        });
        return cleaned;
    }

    async function wireLoginPage() {
        if (!isLoginPage) return;

        const loginForm = document.querySelector('.login-form form');
        const signupForm = document.querySelector('.signup-form form');

        if (loginForm) {
            loginForm.addEventListener('submit', async function (event) {
                if (loginForm.dataset.nativeSubmit === '1') {
                    return;
                }

                event.preventDefault();

                const email = extractBySelector(loginForm, 'input[type="email"]');
                const password = extractBySelector(loginForm, 'input[type="password"]');

                try {
                    const result = await apiFetch('/api/login', {
                        method: 'POST',
                        body: JSON.stringify({ email, password }),
                    });

                    window.location.href = result.redirectTo || '/index.html';
                } catch (err) {
                    submitFormNatively(loginForm);
                }
            });
        }

        if (signupForm) {
            signupForm.addEventListener('submit', async function (event) {
                if (signupForm.dataset.nativeSubmit === '1') {
                    return;
                }

                event.preventDefault();

                const email = extractBySelector(signupForm, 'input[type="email"]');
                const passwordInputs = signupForm.querySelectorAll('input[type="password"]');
                const password = passwordInputs[0] ? String(passwordInputs[0].value || '').trim() : '';
                const confirmPassword = passwordInputs[1] ? String(passwordInputs[1].value || '').trim() : '';

                const nameInput = signupForm.querySelector('input[type="text"]');
                const name = nameInput ? String(nameInput.value || '').trim() : '';

                if (!name || !email || !password) {
                    alert('Please complete name, email, and password.');
                    return;
                }

                if (confirmPassword && password !== confirmPassword) {
                    alert('Passwords do not match.');
                    return;
                }

                const allSignupData = collectFormAsJson(signupForm);
                const profileData = sanitizeProfileData(allSignupData);
                delete profileData.email;
                delete profileData.name;
                delete profileData.nama;

                try {
                    const result = await apiFetch('/api/signup', {
                        method: 'POST',
                        body: JSON.stringify({ name, email, password, profileData }),
                    });

                    window.location.href = result.redirectTo || '/index.html';
                } catch (err) {
                    submitFormNatively(signupForm);
                }
            });
        }
    }

    async function boot() {
        if (isDashboardPage) return;

        await wireLoginPage();

        let me = null;
        try {
            me = await apiFetch('/api/me');
        } catch (_err) {
            if (isPatientProtectedPage()) {
                window.location.replace('login.html');
                return;
            }
            wireUniversalFormSubmission();
            return;
        }

        if (!me || !me.user) {
            if (isPatientProtectedPage()) {
                window.location.replace('login.html');
                return;
            }
            wireUniversalFormSubmission();
            return;
        }

        const user = me.user;

        if (isLoginPage) {
            const redirectTo = user.role === 'admin' ? '/dashboard.html' : '/index.html';
            window.location.href = redirectTo;
            return;
        }

        toggleLoginUiForAuthenticated(user);

        if (user.role === 'patient') {
            rewriteLinksToPatientVariants();

            if (redirectPatientToVariantPage()) {
                return;
            }

            autoFillPatientData(user);
            wireUniversalFormSubmission();
            return;
        }

        wireUniversalFormSubmission();
    }

    document.addEventListener('DOMContentLoaded', boot);
})();
