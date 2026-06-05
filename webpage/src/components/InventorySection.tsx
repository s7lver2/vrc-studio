import React from 'react'

export default function InventorySection() {
  return (
    <div className="big-section" id="inventory">
      <div className="big-section-inner">
        <div className="big-feature-text fade-up">
          <span className="section-tag">Asset Library</span>
          <h2 className="section-title">Your entire collection,<br />always organized.</h2>
          <p className="section-sub">
            Import avatar assets from local files, Booth purchases or direct URLs.
            Search by name, author or tags. Compress to save disk space.
          </p>

          <div className="small-features stagger" style={{ marginTop: 36 }}>
            {([
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                ),
                title: 'Advanced Search',
                desc: <>Filter by tags, author or date. Quick syntax: <code>author:x</code> <code>tags:x</code></>,
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                ),
                title: 'Import Anywhere',
                desc: 'Drag & drop files or import from a URL or Booth purchase history.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="m3 15 2 2 4-4"/>
                  </svg>
                ),
                title: 'Smart Tags',
                desc: 'Auto-tag as base, outfit or accessory. Fully customizable labels.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="8" x="2" y="2" rx="2" ry="2"/>
                    <rect width="20" height="8" x="2" y="14" rx="2" ry="2"/>
                    <line x1="6" y1="6" x2="6.01" y2="6"/>
                    <line x1="6" y1="18" x2="6.01" y2="18"/>
                  </svg>
                ),
                title: 'Storage Compression',
                desc: 'Compress your library to save gigabytes on disk without losing quality.',
              },
            ] as { icon: React.ReactNode; title: string; desc: React.ReactNode }[]).map((f, i) => (
              <div key={f.title} className="small-feature" style={{ '--i': i } as React.CSSProperties}>
                <div className="small-feature-icon">{f.icon}</div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="feature-screenshot fade-up" style={{ transitionDelay: '150ms' }}>
          <div className="screenshot-float screenshot-3d">
            <img src="/assets/screenshots/02-inventory.png" alt="Asset Inventory" loading="lazy" />
          </div>
        </div>
      </div>
    </div>
  )
}
