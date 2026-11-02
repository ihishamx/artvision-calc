"""Skeleton definitions for the first prototype letters (isolated forms). Units: 1000/em, y up, baseline y=0."""
from pen import *

def taper_tip(t): return 1.0 if t < .75 else 1.0 - (t-.75)*2.2   # pointed exit stroke

def G():
    g = {}
    # alef: slightly flared vertical
    g['alef'] = (260, union(stroke(path([((130,720),(130,720),(128,360),(126,0))]), w=82, h=12, ang=60)))
    # ba (isolated): shallow bowl with upward tail on left, dot below
    ba = path([((470,190),(430,0),(250,-40),(70,-20)),((70,-20),(20,-12),(-10,40),(-20,110))])
    g['beh'] = (520, union(stroke(ba, w=76, h=12, ang=55, taper=taper_tip) + dot(240,-210)))
    # lam: vertical stem with deep curved descender to the left
    lam = path([((300,780),(300,780),(296,300),(290,60)),((290,60),(280,-190),(110,-230),(-10,-120))])
    g['lam'] = (340, union(stroke(lam, w=80, h=12, ang=58, taper=taper_tip)))
    # meem: loop + tail
    loop = path([((260,330),(330,330),(360,240),(300,170)),((300,170),(250,110),(130,150),(130,250)),((130,250),(130,320),(200,335),(260,330))])
    tail = path([((300,170),(300,20),(280,-170),(250,-290))])
    g['meem'] = (460, union(stroke(loop, w=70, h=12, ang=55) + stroke(tail, w=70, h=12, ang=55, taper=taper_tip)))
    # ain: top hook + lower bowl
    top = path([((380,420),(320,500),(180,500),(120,430))])
    bowl = path([((120,430),(330,360),(250,200),(120,200)),((120,200),(30,200),(-10,120),(60,50)),((60,50),(140,-20),(330,-40),(440,-170))])
    g['ain'] = (520, union(stroke(top, w=72, h=12, ang=55) + stroke(bowl, w=72, h=12, ang=55, taper=lambda t: 1.0 if t<.8 else 1-(t-.8)*3)))
    # hah: roof stroke + descending hook
    roof = path([((500,360),(400,400),(200,400),(60,340))])
    hook = path([((60,340),(250,240),(300,140),(120,60)),((120,60),(20,10),(60,-130),(300,-190))])
    g['hah'] = (560, union(stroke(roof, w=84, h=12, ang=50) + stroke(hook, w=72, h=12, ang=55, taper=lambda t: 1.0 if t<.85 else 1-(t-.85)*4)))
    # qaf: round head + deep tail, two dots above
    head = path([((300,250),(380,250),(380,130),(300,100)),((300,100),(220,70),(120,100),(120,180)),((120,180),(120,240),(200,255),(300,250))])
    tail = path([((380,150),(380,-90),(230,-200),(40,-170)),((40,-170),(0,-160),(-20,-110),(-30,-60))])
    g['qaf'] = (520, union(stroke(head, w=70, h=12, ang=55) + stroke(tail, w=76, h=12, ang=55, taper=taper_tip) + dot(190,380,30)+dot(270,380,30)))
    # noon: bowl + dot above
    noon = path([((480,230),(470,-10),(250,-40),(60,-30)),((60,-30),(0,-30),(-20,20),(-20,80))])
    g['noon'] = (500, union(stroke(noon, w=76, h=12, ang=55, taper=taper_tip) + dot(230,290)))
    # dal: angular hook
    dal = path([((60,360),(60,360),(180,380),(300,340))]) 
    d2 = path([((300,340),(280,250),(250,150),(220,60)),((220,60),(180,-20),(80,-20),(0,-10))])
    g['dal'] = (380, union(stroke(dal, w=70, h=12, ang=50) + stroke(d2, w=76, h=12, ang=55, taper=lambda t: 1.0 if t<.8 else 1-(t-.8)*3)))
    # waw: head loop + descending tail
    wl = path([((190,300),(260,300),(280,210),(220,150)),((220,150),(160,100),(60,140),(60,220)),((60,220),(60,280),(120,305),(190,300))])
    wt = path([((220,150),(230,0),(130,-170),(-40,-210))])
    g['waw'] = (400, union(stroke(wl, w=70, h=12, ang=55) + stroke(wt, w=74, h=12, ang=55, taper=taper_tip)))
    return g
