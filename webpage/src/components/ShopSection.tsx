import React from 'react'

export default function ShopSection() {
  return (
    <div className="big-section" id="shop">
      <div className="big-section-inner reversed">
        <div className="big-feature-text fade-up">
          <span className="section-tag">Booth Marketplace</span>
          <h2 className="section-title">Browse, download,<br />track — all in-app.</h2>
          <p className="section-sub">
            Search Booth.pm directly inside VRC Studio. Download purchases,
            manage your library and track price drops without leaving the app.
          </p>

          <div className="small-features stagger" style={{ marginTop: 36 }}>
            {([
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 0 1-8 0"/>
                  </svg>
                ),
                title: 'In-App Browser',
                desc: 'Search and browse Booth.pm without switching windows. Your account stays synced.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                ),
                title: 'Direct Download',
                desc: 'Download assets straight into your inventory. No manual file management needed.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 20V10"/>
                    <path d="M12 20V4"/>
                    <path d="M6 20v-6"/>
                  </svg>
                ),
                title: 'Price Tracker',
                desc: 'Set alerts on items you want. Get notified on price drops or restocks automatically.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                ),
                title: 'Purchase History',
                desc: 'Sync your Booth account and instantly see everything you own, already imported.',
              },
            ] as { icon: React.ReactNode; title: string; desc: string }[]).map((f, i) => (
              <div key={f.title} className="small-feature" style={{ '--i': i } as React.CSSProperties}>
                <div className="small-feature-icon">{f.icon}</div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="feature-screenshot fade-up" style={{ transitionDelay: '150ms' }}>
          <div className="screenshot-float screenshot-3d-right">
            <img src="/assets/screenshots/shop.png" alt="Booth Shop integration" loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).src = '/assets/screenshots/02-inventory.png' }} />
          </div>
          {/* Decorative floating chips */}
          <div className="shop-chip shop-chip-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <span>¥3,800 → ¥2,200</span>
            <span className="chip-badge">−42%</span>
          </div>
          <div className="shop-chip shop-chip-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Downloaded</span>
          </div>
        </div>
      </div>
    </div>
  )
}
