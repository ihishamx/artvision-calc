"""Broad-nib pen model: sweep a rotated nib along skeleton Béziers, union with pyclipper.
Original construction — outlines are generated from skeleton + nib parameters, never traced from images."""
import math, pyclipper
S = 100  # clipper scale

def bez(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                    u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return out

def path(segs, n=24):
    pts = []
    for s in segs:
        c = bez(*s, n=n) if len(s) == 4 else [s[0], s[1]]
        pts += c if not pts else c[1:]
    return pts

def nib(w, h, ang):
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    return [(x*ca - y*sa, x*sa + y*ca) for x, y in
            [(-w/2, -h/2), (w/2, -h/2), (w/2, h/2), (-w/2, h/2)]]

def hull(pts):
    pts = sorted(set(pts))
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def stroke(pts, w=70, h=14, ang=55, taper=None):
    """taper: optional f(t)->(w,h) scale factor for stroke width along the path."""
    polys = []
    n = len(pts)
    for i in range(n - 1):
        t0, t1 = i/(n-1), (i+1)/(n-1)
        k0 = taper(t0) if taper else 1.0
        k1 = taper(t1) if taper else 1.0
        n0, n1 = nib(w*k0, h, ang), nib(w*k1, h, ang)
        poly = hull([(pts[i][0]+x, pts[i][1]+y) for x, y in n0] +
                    [(pts[i+1][0]+x, pts[i+1][1]+y) for x, y in n1])
        polys.append([(round(x*S), round(y*S)) for x, y in poly])
    return polys

def union(polys):
    pc = pyclipper.Pyclipper()
    pc.AddPaths(polys, pyclipper.PT_SUBJECT, True)
    res = pc.Execute(pyclipper.CT_UNION, pyclipper.PFT_NONZERO, pyclipper.PFT_NONZERO)
    return [[(x/S, y/S) for x, y in c] for c in res]

def dot(cx, cy, r=34, ang=45):
    d = [(cx + r*math.cos(math.radians(ang+90*i))*1.0, cy + r*math.sin(math.radians(ang+90*i))*1.0) for i in range(4)]
    return [[(round(x*S), round(y*S)) for x, y in d]]
