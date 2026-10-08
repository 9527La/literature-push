# -*- coding: utf-8 -*-
"""生成 TabBar 图标（5 glyph x 2 状态），零第三方依赖。

做法：4x 超采样做形状覆盖测试，盒式降采样得到抗锯齿 alpha，
纯 zlib/struct 写 PNG（RGBA，96x96）。
颜色：普通 #6b7280，选中 #3157d5（与 app.config.js tabBar 一致）。
"""
import math
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "tab"
SIZE = 96
SS = 4  # 超采样倍数
NORMAL = (0x6B, 0x7B, 0x80 >> 4)  # placeholder, replaced below


def color(hexstr):
    hexstr = hexstr.lstrip("#")
    return tuple(int(hexstr[i:i + 2], 16) for i in (0, 2, 4))


NORMAL_COLOR = color("6b7280")
ACTIVE_COLOR = color("3157d5")


def rounded_rect(x0, y0, x1, y1, r):
    def inside(x, y):
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return inside


def circle(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def ellipse_half(cx, cy, rx, ry, upper=True):
    def inside(x, y):
        if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1:
            return False
        return y <= cy if upper else y >= cy
    return inside


def polygon(points):
    def inside(x, y):
        hit = False
        n = len(points)
        for i in range(n):
            x1, y1 = points[i]
            x2, y2 = points[(i + 1) % n]
            if (y1 > y) != (y2 > y):
                t = (y - y1) / (y2 - y1)
                if x < x1 + t * (x2 - x1):
                    hit = not hit
        return hit
    return inside


def union(*shapes):
    return lambda x, y: any(shape(x, y) for shape in shapes)


def star5(cx, cy, r_out, r_in, rotation=-math.pi / 2):
    pts = []
    for i in range(10):
        r = r_out if i % 2 == 0 else r_in
        angle = rotation + i * math.pi / 5
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return polygon(pts)


def sparkle(cx, cy, r, product_limit):
    def inside(x, y):
        dx, dy = abs(x - cx), abs(y - cy)
        return dx + dy <= r and dx * dy <= product_limit
    return inside


def shape_feed(x, y):
    dome = ellipse_half(48, 42, 21, 20)
    skirt = polygon([(34, 42), (27, 60), (69, 60), (62, 42)])
    base = rounded_rect(24, 60, 72, 64, 2)
    clapper = circle(48, 69, 5)
    return dome(x, y) or skirt(x, y) or base(x, y) or clapper(x, y)


def shape_report(x, y):
    return sparkle(48, 48, 33, 130)(x, y) or sparkle(70, 22, 10, 14)(x, y)


def shape_news(x, y):
    body = rounded_rect(22, 24, 74, 74, 6)
    lines = [
        rounded_rect(30, 34, 66, 40, 1.5),
        rounded_rect(30, 46, 66, 52, 1.5),
        rounded_rect(30, 58, 52, 64, 1.5),
    ]
    def inside(x, y):
        if not body(x, y):
            return False
        return not any(line(x, y) for line in lines)
    return inside(x, y)


def shape_fav(x, y):
    return star5(48, 51, 30, 12.5)(x, y)


def shape_mine(x, y):
    head = circle(48, 33, 13)
    body = ellipse_half(48, 72, 22, 20)
    return head(x, y) or body(x, y)


SHAPES = {
    "feed": shape_feed,
    "report": shape_report,
    "news": shape_news,
    "fav": shape_fav,
    "mine": shape_mine,
}


def render(shape_fn, rgb):
    step = 1.0 / SS
    samples = [(i + 0.5) * step for i in range(SIZE * SS)]
    alpha = [[0.0] * SIZE for _ in range(SIZE)]
    for py in range(SIZE):
        base_y = py * SS
        for px in range(SIZE):
            base_x = px * SS
            hit = 0
            for sy in samples[base_y:base_y + SS]:
                for sx in samples[base_x:base_x + SS]:
                    if shape_fn(sx, sy):
                        hit += 1
            alpha[py][px] = hit / (SS * SS)

    raw = bytearray()
    for py in range(SIZE):
        raw.append(0)  # filter: none
        for px in range(SIZE):
            a = round(alpha[py][px] * 255)
            raw.extend(bytes((rgb[0], rgb[1], rgb[2], a)))
    return encode_png(SIZE, SIZE, bytes(raw))


def encode_png(width, height, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, shape in SHAPES.items():
        for suffix, rgb in (("", NORMAL_COLOR), ("-active", ACTIVE_COLOR)):
            path = OUT_DIR / f"{name}{suffix}.png"
            path.write_bytes(render(shape, rgb))
            print("wrote", path)


if __name__ == "__main__":
    main()
