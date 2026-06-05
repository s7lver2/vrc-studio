export default function Install() {
  return (
    <div className="install-section" id="install">
      <div className="install-inner">
        <div className="fade-up" style={{ textAlign: 'center' }}>
          <span className="section-tag">Installation</span>
          <h2 className="section-title">Up and running<br />in three steps.</h2>
          <p className="section-sub" style={{ margin: '20px auto 0' }}>
            VRC Studio is a native desktop app built with Tauri and React. Requires Windows and Unity installed.
          </p>
        </div>

        <div className="install-steps fade-up stagger">
          <div className="install-step" style={{ '--i': 0 } as React.CSSProperties}>
            <div className="step-number">1</div>
            <h3>Download</h3>
            <p>
              Grab the latest installer from GitHub Releases.
              Look for <code>VRC.Studio_x.x.x_x64-setup.exe</code>.
            </p>
          </div>

          <div className="install-step" style={{ '--i': 1 } as React.CSSProperties}>
            <div className="step-number">2</div>
            <h3>Install</h3>
            <p>
              Run the installer. Windows may show a SmartScreen warning for unsigned apps — click{' '}
              <em>Run anyway</em> to proceed.
            </p>
          </div>

          <div className="install-step" style={{ '--i': 2 } as React.CSSProperties}>
            <div className="step-number">3</div>
            <h3>Launch &amp; Configure</h3>
            <p>
              Open VRC Studio. Follow the setup wizard to scan for existing Unity projects
              and configure your VPM sources.
            </p>
          </div>
        </div>

        <div className="install-note fade-up">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>
            VRC Studio is currently in early development (v0.0.13). Some features are marked as Work in Progress.
            Contributions and feedback are welcome on{' '}
            <a href="https://github.com/s7lver/vrc-studio" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>.
          </span>
        </div>
      </div>
    </div>
  )
}
