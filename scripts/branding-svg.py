# Membuat ulang SVG dekoratif dashboard: python3 scripts/branding-svg.py src/assets/branding
# Generate decorative SVGs (stylized Indonesia map + satellite). Coordinates are rough lon/lat outlines.
import math, sys
ISL = {
 'sumatra':[(95.3,5.6),(97.5,5.2),(98.7,3.8),(100.4,2.2),(101.5,1.7),(103.7,0.5),(103.8,-1.0),(104.5,-1.9),(106.0,-3.2),(105.8,-5.8),(104.6,-5.9),(102.3,-4.0),(100.9,-2.2),(99.2,0.2),(97.5,2.5),(95.9,4.4)],
 'java':[(105.2,-6.8),(106.1,-6.0),(108.3,-6.3),(110.4,-6.9),(112.6,-6.9),(114.4,-7.7),(114.6,-8.6),(112.5,-8.4),(110.0,-8.1),(108.0,-7.8),(106.4,-7.4)],
 'borneo':[(109.0,1.5),(110.3,1.7),(111.8,2.9),(113.0,3.2),(114.5,4.6),(116.0,6.9),(117.5,6.5),(119.2,5.2),(118.0,4.2),(117.6,3.0),(118.9,1.0),(117.9,0.1),(117.5,-0.9),(116.6,-2.5),(116.2,-4.0),(114.6,-3.8),(113.0,-3.2),(111.7,-3.0),(110.2,-2.9),(110.1,-1.7),(109.3,-0.8),(109.0,0.3)],
 'sulawesi':[(119.5,-5.5),(119.4,-3.4),(118.8,-2.6),(119.8,0.2),(120.5,0.8),(121.0,1.3),(122.7,1.0),(124.4,1.2),(125.2,1.6),(124.6,0.4),(123.2,0.5),(121.3,0.5),(120.6,0.0),(120.9,-1.2),(121.6,-0.9),(122.9,-0.8),(121.3,-1.9),(122.4,-3.4),(123.2,-4.6),(122.0,-4.7),(121.4,-4.0),(120.9,-2.7),(120.4,-3.4),(120.4,-5.5)],
 'papua':[(131.0,-1.3),(132.4,-0.4),(134.1,-0.9),(134.4,-2.6),(135.5,-3.3),(137.6,-1.5),(138.8,-1.9),(141.0,-2.6),(141.0,-9.1),(139.0,-8.1),(138.0,-8.4),(137.8,-7.0),(136.0,-4.6),(134.6,-4.0),(133.0,-4.1),(132.0,-2.9),(133.4,-2.3),(132.0,-2.1)],
 'halmahera':[(127.5,2.2),(128.1,1.5),(128.7,1.4),(128.0,0.8),(128.8,0.3),(128.2,-0.2),(127.7,0.4),(127.6,1.2)],
 'seram':[(127.9,-3.0),(129.5,-2.8),(130.9,-3.4),(129.6,-3.5),(128.2,-3.6)],
 'buru':[(126.0,-3.1),(127.2,-3.2),(126.8,-3.8),(126.0,-3.7)],
 'bali':[(114.5,-8.1),(115.7,-8.4),(115.2,-8.8)],
 'lombok':[(116.0,-8.3),(116.7,-8.3),(116.5,-8.9),(116.0,-8.8)],
 'sumbawa':[(116.8,-8.4),(119.0,-8.1),(118.8,-8.8),(117.0,-9.0)],
 'flores':[(119.8,-8.4),(123.0,-8.2),(122.6,-8.7),(120.0,-8.8)],
 'sumba':[(119.0,-9.4),(120.8,-9.7),(119.8,-10.0)],
 'timor':[(123.5,-10.3),(125.0,-9.2),(127.3,-8.4),(125.0,-9.9),(124.0,-10.4)],
 'bangka':[(105.1,-1.6),(106.0,-1.8),(106.8,-3.0),(106.0,-2.9)],
}
CITIES=[(106.8,-6.2),(98.7,3.6),(104.7,-2.9),(110.4,-7.0),(112.7,-7.3),(115.2,-8.6),(109.3,0.0),(116.8,-1.3),(119.4,-5.1),(124.8,1.5),(128.2,-3.7),(140.7,-2.6),(134.0,-0.9),(123.6,-10.2),(100.4,-0.9),(113.9,-2.2)]
LINKS=[(0,1),(0,2),(0,3),(3,4),(4,5),(0,6),(6,7),(7,8),(8,9),(8,10),(10,11),(11,12),(8,13),(1,14),(14,2),(7,15),(15,4),(5,13),(9,12)]
def proj(lon,lat,x0,y0,k): return (x0+(lon-95)*k, y0+(6.5-lat)*k)
def path(pts,x0,y0,k):
    q=[proj(a,b,x0,y0,k) for a,b in pts]
    return 'M'+' L'.join(f'{x:.1f} {y:.1f}' for x,y in q)+'Z'
def mapgroup(x0,y0,k,fill,stroke,cityr):
    s=[f'<g fill="{fill}" stroke="{stroke}" stroke-width="0.8" stroke-linejoin="round">']
    s+= [f'<path d="{path(p,x0,y0,k)}"/>' for p in ISL.values()]
    s.append('</g><g fill="none" stroke="#5cc8ff" stroke-width="0.9" stroke-opacity="0.75">')
    for a,b in LINKS:
        (x1,y1),(x2,y2)=proj(*CITIES[a],x0,y0,k),proj(*CITIES[b],x0,y0,k)
        mx,my=(x1+x2)/2,(y1+y2)/2-abs(x2-x1)*0.18-6
        s.append(f'<path d="M{x1:.1f} {y1:.1f} Q{mx:.1f} {my:.1f} {x2:.1f} {y2:.1f}"/>')
    s.append('</g><g fill="#bdf0ff" filter="url(#glow)">')
    s+=[f'<circle cx="{proj(*c,x0,y0,k)[0]:.1f}" cy="{proj(*c,x0,y0,k)[1]:.1f}" r="{cityr}"/>' for c in CITIES]
    s.append('</g>'); return ''.join(s)
def satellite(x,y,sc,rot):
    return f'''<g transform="translate({x} {y}) rotate({rot}) scale({sc})">
<g stroke="#9fd8ff" stroke-width="1.2"><line x1="-46" y1="0" x2="-16" y2="0"/><line x1="16" y1="0" x2="46" y2="0"/></g>
<rect x="-78" y="-13" width="34" height="26" rx="2" fill="url(#panel)" stroke="#cfe8ff" stroke-width="1.2"/>
<rect x="44" y="-13" width="34" height="26" rx="2" fill="url(#panel)" stroke="#cfe8ff" stroke-width="1.2"/>
<path d="M-72 -13V13M-61 -13V13M-50 -13V13M50 -13V13M61 -13V13M72 -13V13M-78 0H-44M44 0H78" stroke="#cfe8ff" stroke-opacity=".55" stroke-width=".8"/>
<rect x="-15" y="-18" width="30" height="36" rx="5" fill="url(#body)" stroke="#ffffff" stroke-opacity=".7"/>
<rect x="-15" y="-6" width="30" height="5" fill="#c9a24a" opacity=".85"/>
<path d="M0 18 L0 26" stroke="#dfe8f5" stroke-width="2"/><ellipse cx="0" cy="30" rx="11" ry="5" fill="#e8eef7" stroke="#9fb3cc"/>
</g>'''
DEFS='''<defs>
<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient>
<linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1f5f9"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="earth" cx="0.5" cy="0.35" r="0.65"><stop offset="0" stop-color="#1d6fe0"/><stop offset=".55" stop-color="#0b3a8f"/><stop offset="1" stop-color="#061a45"/></radialGradient>
<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset=".78" stop-color="#38bdf8" stop-opacity="0"/><stop offset=".86" stop-color="#38bdf8" stop-opacity=".55"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
</defs>'''
def waves(x,y,rot,n=3,color='#7dd3fc'):
    return ''.join(f'<path d="M{x-10-i*9} {y+10+i*9} A{14+i*12} {14+i*12} 0 0 1 {x+10+i*9} {y+10+i*9}" transform="rotate({rot} {x} {y})" fill="none" stroke="{color}" stroke-opacity="{0.8-i*0.2:.1f}" stroke-width="1.6" stroke-linecap="round"/>' for i in range(n))

# Banner 1200x140, Indonesia map with glowing network, earth limb and satellite at right.
banner=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 140" preserveAspectRatio="xMidYMid slice">{DEFS}
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b1d4a"/><stop offset=".55" stop-color="#0d2f78"/><stop offset="1" stop-color="#0a2a6b"/></linearGradient>
<rect width="1400" height="140" fill="url(#bg)"/>
<g fill="#ffffff" opacity=".55">{''.join(f'<circle cx="{(i*137)%1400}" cy="{(i*53)%140}" r="{0.6+(i%3)*0.35:.2f}"/>' for i in range(70))}</g>
<ellipse cx="700" cy="420" rx="520" ry="330" fill="url(#earth)"/>
<ellipse cx="700" cy="420" rx="545" ry="355" fill="url(#halo)"/>
{mapgroup(540,14,6.8,'#1e63d6','#7cc4ff',1.9)}
{waves(918,86,215,3)}
{satellite(955,44,0.62,-24)}
</svg>'''
# Sidebar art 256x220: earth from below, satellite, signal waves; top fades into sidebar navy.
side=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 220">{DEFS}
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".3" stop-color="#fff"/></linearGradient><mask id="m"><rect width="256" height="220" fill="url(#fade)"/></mask><g mask="url(#m)">
<clipPath id="ec"><circle cx="150" cy="330" r="200"/></clipPath>
<circle cx="150" cy="330" r="222" fill="url(#halo)"/>
<circle cx="150" cy="330" r="200" fill="url(#earth)"/>
<g clip-path="url(#ec)" opacity=".9">{mapgroup(78,148,3.2,'#2a7be4','#8fd0ff',1.3)}</g>
{waves(90,98,135,3)}
{satellite(62,70,0.5,-30)}
</g>
</svg>'''
open(sys.argv[1]+'/banner-satelit-indonesia.svg','w').write(banner)
open(sys.argv[1]+'/ilustrasi-satelit-sidebar.svg','w').write(side)
# Accent for the white Monitoring Program card: light map + network on transparent background.
acc=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 110">{DEFS}{mapgroup(4,4,6.2,'#dbeafe','#bfdbfe',1.6).replace('#5cc8ff','#60a5fa').replace('#bdf0ff','#3b82f6')}</svg>'''
open(sys.argv[1]+'/aksen-jaringan-indonesia.svg','w').write(acc)
