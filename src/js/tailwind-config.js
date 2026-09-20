tailwind.config = {
    theme: {
        extend: {
            colors: { 
                bgDark: 'rgb(var(--bg-main) / <alpha-value>)', 
                sidebarDark: 'rgb(var(--bg-sidebar) / <alpha-value>)', 
                borderDark: 'rgb(var(--border-color) / <alpha-value>)',
                textMain: 'rgb(var(--text-main) / <alpha-value>)',
                textMuted: 'rgb(var(--text-muted) / <alpha-value>)',
                accent: 'rgb(var(--accent) / <alpha-value>)', 
                mint: '#10b981' 
            },
            fontFamily: { sans: ['Inter', 'SF Pro', 'sans-serif'] }
        }
    }
}
