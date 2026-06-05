import React from 'react'

export default function PrivacySection() {
  return (
    <div className="big-section" id="privacy">
      <div className="big-section-inner">
        <div className="big-feature-text fade-up">
          <span className="section-tag">Privacy &amp; Control</span>
          <h2 className="section-title">Local first.<br />Always yours.</h2>
          <p className="section-sub">
            All your data is stored locally on your machine.
            Nothing is uploaded to external servers. No accounts required.
          </p>

          <div className="small-features stagger" style={{ marginTop: 36 }}>
            {([
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                ),
                title: 'No Cloud',
                desc: 'Everything stays on your machine. Zero telemetry.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                    <line x1="9" y1="9" x2="9.01" y2="9"/>
                    <line x1="15" y1="9" x2="15.01" y2="9"/>
                  </svg>
                ),
                title: 'Multi-language',
                desc: 'English, Spanish and German support built in.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 7h-9"/>
                    <path d="M14 17H5"/>
                    <circle cx="17" cy="17" r="3"/>
                    <circle cx="7" cy="7" r="3"/>
                  </svg>
                ),
                title: 'Customizable',
                desc: 'Custom tag labels, sidebar width, appearance themes.',
              },
              {
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2H3v16h5v4l4-4h4l5-5V2zm-11 7v5m4-5v5"/>
                  </svg>
                ),
                title: 'Auto Updates',
                desc: 'Always stay on the latest version with built-in update checks.',
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
          <div className="screenshot-float screenshot-3d">
            <img src="/assets/screenshots/05-settings.png" alt="Settings" loading="lazy" />
          </div>
        </div>
      </div>
    </div>
  )
}
