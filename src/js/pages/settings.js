(function(){
    const appSettings = document.getElementById('app-settings');
    const mobileHeader = document.getElementById('mobile-header');
    const mobileHeaderTitle = document.getElementById('mobile-header-title');
    const mobileSettingsBack = document.getElementById('mobile-settings-back');
    const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

    function setMobileDetailChrome(detail, title){
        if (!isMobile()) {
            if (mobileSettingsBack) mobileSettingsBack.hidden = true;
            return;
        }
        if (mobileSettingsBack) mobileSettingsBack.hidden = !detail;
        if (mobileHeaderTitle) mobileHeaderTitle.textContent = detail ? 'Settings' : 'Settings';
        if (mobileHeader) mobileHeader.classList.toggle('settings-detail-active', !!detail);
        // The old in-page detail topbar is intentionally unused on mobile.
        const oldTopbar = document.getElementById('settings-mobile-topbar');
        if (oldTopbar) oldTopbar.setAttribute('aria-hidden', detail ? 'true' : 'true');
    }

    function activateSettingsTab(name, opts){
        opts = opts || {};
        document.querySelectorAll('#settings-nav .settings-tab-btn').forEach(b=>{
            b.classList.toggle('active', b.dataset.settingsTab===name);
        });
        document.querySelectorAll('[data-settings-panel]').forEach(p=>{
            p.classList.toggle('hidden', p.dataset.settingsPanel!==name);
        });
        try{ localStorage.setItem('settings-active-tab', name); }catch(e){}
        if(name === 'notifications' && window.NotifSystem){ NotifSystem.renderPanel(); }

        if (isMobile() && opts.userInitiated) {
            const btn = document.querySelector('#settings-nav .settings-tab-btn[data-settings-tab="'+name+'"]');
            const title = document.getElementById('settings-mobile-title');
            if (title) title.textContent = btn ? btn.dataset.settingsLabel : '';
            appSettings.classList.add('settings-mobile-detail');
            setMobileDetailChrome(true, btn ? btn.dataset.settingsLabel : 'Settings');
            const wrap = document.getElementById('settings-panels-wrap');
            if (wrap) wrap.scrollTop = 0;
            const shell = appSettings.querySelector('.settings-shell');
            if (shell) shell.scrollTop = 0;
        }
    }

    document.querySelectorAll('#settings-nav .settings-tab-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>activateSettingsTab(btn.dataset.settingsTab, { userInitiated: true }));
    });

    function returnToSettingsList(){
        appSettings.classList.remove('settings-mobile-detail');
        document.querySelectorAll('#settings-nav .settings-tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('[data-settings-panel]').forEach(p=>p.classList.add('hidden'));
        try { localStorage.removeItem('settings-active-tab'); } catch(e) {}
        setMobileDetailChrome(false);
        const shell = appSettings.querySelector('.settings-shell');
        if (shell) shell.scrollTop = 0;
    }

    const backBtn = document.getElementById('settings-back-btn');
    if (backBtn) backBtn.addEventListener('click', returnToSettingsList);
    if (mobileSettingsBack) mobileSettingsBack.addEventListener('click', returnToSettingsList);

    window.addEventListener('resize', ()=>{
        if (!isMobile()) {
            if (mobileSettingsBack) mobileSettingsBack.hidden = true;
            appSettings.classList.remove('settings-mobile-detail');
        } else if (appSettings.classList.contains('settings-mobile-detail')) {
            setMobileDetailChrome(true);
        }
    });

    const saved = (function(){ try{return localStorage.getItem('settings-active-tab')}catch(e){return null} })();
    activateSettingsTab(saved || 'appearance', { userInitiated: false });
    setMobileDetailChrome(false);
})();

