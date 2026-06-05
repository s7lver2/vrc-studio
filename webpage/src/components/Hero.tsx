import { useEffect, useRef } from 'react'

export default function Hero() {
  const heroRef = useRef<HTMLDivElement>(null)
  const mockupRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const hero = heroRef.current
    const mockup = mockupRef.current
    const bg = bgRef.current
    if (!hero || !mockup || !bg) return

    const handleScroll = () => {
      bg.style.transform = `translateY(${window.scrollY * 0.3}px)`
    }
    window.addEventListener('scroll', handleScroll, { passive: true })

    const handleMouseMove = (e: MouseEvent) => {
      const rect = hero.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = (e.clientX - cx) / rect.width
      const dy = (e.clientY - cy) / rect.height
      mockup.style.transform = `perspective(1200px) rotateX(${4 - dy * 6}deg) rotateY(${dx * 6 - 1}deg)`
      mockup.style.transition = 'transform 0.1s ease'
    }
    const handleMouseLeave = () => {
      mockup.style.transform = 'perspective(1200px) rotateX(4deg) rotateY(-1deg)'
      mockup.style.transition = 'transform 0.6s ease'
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

      <div className="hero-badge">Free &amp; Open Source</div>

      <h1>
        <span className="red">VRC</span> Studio
      </h1>

      <p className="hero-sub">
        Your all-in-one toolkit for VRChat avatar creation.
        Manage projects, assets, packages and version control — all in one place.
      </p>

      <div className="hero-actions">
        <a href="https://github.com/s7lver/vrc-studio/releases" className="btn-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download for Windows
        </a>
        <a href="https://github.com/s7lver/vrc-studio" className="btn-secondary">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 98 96" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"/>
          </svg>
          View on GitHub
        </a>
      </div>

      <div className="hero-mockup">
        <div className="mockup-window" ref={mockupRef}>
          <div className="mockup-bar">
            <div className="dot dot-red" />
            <div className="dot dot-yellow" />
            <div className="dot dot-green" />
          </div>
          <img src="/assets/screenshots/01-projects.png" alt="VRC Studio — Projects view" loading="eager" />
        </div>
        <div className="mockup-glow" />
      </div>
    </div>
  )
}
