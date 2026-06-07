import { useEffect, useRef, useState } from 'react'

const GITHUB_REPO = 's7lver/vrc-studio'

export default function Hero() {
  const heroRef   = useRef<HTMLDivElement>(null)
  const mockupRef = useRef<HTMLDivElement>(null)
  const bgRef     = useRef<HTMLDivElement>(null)

  const [dlState, setDlState]     = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [dlUrl, setDlUrl]         = useState<string | null>(null)
  const [dlVersion, setDlVersion] = useState<string | null>(null)

  // Fetch latest release metadata on mount so the download is instant on click
  useEffect(() => {
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => {
        const asset = (data.assets ?? []).find(
          (a: { name: string }) =>
            /setup.*\.exe$/i.test(a.name) || /\.msi$/i.test(a.name) || /x64.*\.exe$/i.test(a.name)
        )
        setDlUrl(asset?.browser_download_url ?? data.html_url ?? `https://github.com/${GITHUB_REPO}/releases`)
        setDlVersion(data.tag_name ?? null)
        setDlState('ready')
      })
      .catch(() => {
        setDlUrl(`https://github.com/${GITHUB_REPO}/releases`)
        setDlState('error')
      })
  }, [])

  const handleDownload = () => {
    if (!dlUrl) {
      window.open(`https://github.com/${GITHUB_REPO}/releases`, '_blank')
      return
    }
    // Direct link — browser handles the download
    const a = document.createElement('a')
    a.href = dlUrl
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  useEffect(() => {
    const hero   = heroRef.current
    const mockup = mockupRef.current
    const bg     = bgRef.current
    if (!hero || !mockup || !bg) return

    const handleScroll = () => {
      bg.style.transform = `translateY(${window.scrollY * 0.28}px)`
    }
    window.addEventListener('scroll', handleScroll, { passive: true })

    const handleMouseMove = (e: MouseEvent) => {
      const rect = hero.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top  + rect.height / 2
      const dx = (e.clientX - cx) / rect.width
      const dy = (e.clientY - cy) / rect.height
      mockup.style.transform  = `perspective(1200px) rotateX(${4 - dy * 7}deg) rotateY(${dx * 7 - 1}deg)`
      mockup.style.transition = 'transform 0.1s ease'
    }
    const handleMouseLeave = () => {
      mockup.style.transform  = 'perspective(1200px) rotateX(4deg) rotateY(-1deg)'
      mockup.style.transition = 'transform 0.7s ease'
    }

    hero.addEventListener('mousemove', handleMouseMove)
    hero.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      hero.removeEventListener('mousemove', handleMouseMove)
      hero.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  return (
    <div className="hero" ref={heroRef}>
      <div className="hero-bg" ref={bgRef} />
      <div className="hero-grid" aria-hidden />

      <div className="hero-badge">
        <span className="hero-badge-dot" />
        Free &amp; Open Source
      </div>

      <h1>
        <span className="red">VRC</span> Studio
      </h1>

      <p className="hero-sub">
        Your all-in-one toolkit for VRChat avatar creation.
        Manage projects, assets, packages and version control — all in one place.
      </p>

      <div className="hero-actions">
        <button className="btn-primary" onClick={handleDownload} disabled={dlState === 'loading'}>
          {dlState === 'loading' ? (
            <svg className="spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          )}
          Download for Windows
          {dlVersion && <span className="btn-version">{dlVersion}</span>}
        </button>

        <a href={`https://github.com/${GITHUB_REPO}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 98 96" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"/>
          </svg>
          View on GitHub
        </a>
      </div>

      {/* Stats strip */}
      <div className="hero-stats">
        <div className="hero-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          Windows 10 / 11
        </div>
        <span className="hero-stat-sep" />
        <div className="hero-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          No account needed
        </div>
        <span className="hero-stat-sep" />
        <div className="hero-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span style={{ color: '#4ade80' }}>Always free</span>
        </div>
      </div>

      <div className="hero-mockup">
        <div className="mockup-window" ref={mockupRef}>
          <div className="mockup-bar">
            <div className="dot dot-red" />
            <div className="dot dot-yellow" />
            <div className="dot dot-green" />
            <span className="mockup-title">VRC Studio</span>
          </div>
          <img src="/assets/screenshots/01-projects.png" alt="VRC Studio — Projects view" loading="eager" />
        </div>
        <div className="mockup-glow" />
        <div className="mockup-glow-2" />
      </div>
    </div>
  )
}
