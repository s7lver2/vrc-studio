export default function FeatureGrid() {
  return (
    <section id="features">
      <div className="fade-up">
        <span className="section-tag">Features</span>
        <h2 className="section-title">Everything you need,<br />nothing you don't.</h2>
        <p className="section-sub">Built for VRChat creators who want to stop juggling tools and start creating.</p>
      </div>

      <div className="feature-grid fade-up stagger">
        <div className="feature-card" style={{ '--i': 0 } as React.CSSProperties}>
          <div className="feature-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/>
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/>
              <path d="M2 7h20"/>
              <path d="M22 7v3a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1-2 2 2 2 0 0 1-2-2a2 2 0 0 1-2 2 2 2 0 0 1-2-2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V7"/>
            </svg>
          </div>
          <h3>Project Manager</h3>
          <p>Create, scan, and open Unity VRChat projects. Track your avatars in one organized hub.</p>
        </div>

        <div className="feature-card" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="feature-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          </div>
          <h3>VPM Package Manager</h3>
          <p>Install, update and remove VPM packages per project. Multi-source repository support.</p>
        </div>

        <div className="feature-card" style={{ '--i': 2 } as React.CSSProperties}>
          <div className="feature-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
              <path d="m3.3 7 8.7 5 8.7-5"/>
              <path d="M12 22V12"/>
            </svg>
          </div>
          <h3>Asset Inventory</h3>
          <p>Import avatars, outfits and accessories. Tag, filter, and organize your entire library.</p>
        </div>

        <div className="feature-card" style={{ '--i': 3 } as React.CSSProperties}>
          <div className="feature-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="18" r="3"/>
              <circle cx="6" cy="6" r="3"/>
              <circle cx="18" cy="6" r="3"/>
              <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/>
              <path d="M12 12v3"/>
            </svg>
          </div>
          <h3>Git Integration</h3>
          <p>Commit, branch, push and sync with GitHub — all from inside VRC Studio.</p>
        </div>

        <div className="feature-card" style={{ '--i': 4 } as React.CSSProperties}>
          <div className="feature-icon" style={{ background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.25)', color: '#fbbf24' }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
          </div>
          <h3>Booth Shop <span className="feature-badge">Soon</span></h3>
          <p>Browse and track purchased items from Booth.pm directly in the app.</p>
        </div>

        <div className="feature-card" style={{ '--i': 5 } as React.CSSProperties}>
          <div className="feature-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <h3>Smart Settings</h3>
          <p>Multi-language support, custom behavior labels, storage compression and more.</p>
        </div>
      </div>
    </section>
  )
}
