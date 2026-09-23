"""Export approved composite imagery and extend its catalog treatment to all products.

Run: python scripts/build_imagery.py
Optional authoring dependencies: Pillow, numpy, opencv-python.
No runtime/build dependency: exports are checked in and served as static WebP files.
Source artwork and the historical approval board are never overwritten.
"""
from pathlib import Path
import json
import re
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
REVIEW = ROOT / 'design-review/imagery-v1/concepts'
OUT = ROOT / 'assets/images/studio'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'catalog').mkdir(exist_ok=True)
RESAMPLE = Image.Resampling.LANCZOS


def export(image, target, widths):
    image = image.convert('RGB')
    for width in widths:
        assert width <= image.width, 'Do not upscale delivery images'
        resized = image.resize((width, round(image.height * width / image.width)), RESAMPLE)
        suffix = '' if width == widths[0] else f'-{width}'
        resized.save(OUT / f'{target}{suffix}.webp', 'WEBP', quality=88, method=6)


def cutout(source):
    image = Image.open(source).convert('RGB')
    rgb = np.array(image)
    assert image.size == (1254, 1254), f'New source needs an individually reviewed mask: {source}'
    # Same reviewed silhouette as the approved three-product samples.
    points = np.array([(349,306),(366,279),(405,249),(454,227),(506,211),(562,204),(607,208),(649,220),(675,238),(686,259),(709,349),(715,376),(709,400),(694,420),(712,445),(730,466),(745,489),(761,518),(880,918),(889,949),(885,978),(870,1007),(838,1035),(800,1056),(752,1073),(702,1087),(650,1095),(602,1094),(565,1086),(541,1073),(523,1053),(515,1029),(411,585),(409,559),(417,530),(431,506),(437,493),(412,490),(392,473),(379,450),(368,418),(353,398),(348,382),(339,350),(340,326)], np.int32)
    rough = np.zeros(rgb.shape[:2], np.uint8)
    cv2.fillPoly(rough, [points], 255)
    core = cv2.erode(rough, np.ones((17,17), np.uint8))
    outer = cv2.dilate(rough, np.ones((17,17), np.uint8))
    mask = np.full(rough.shape, cv2.GC_BGD, np.uint8)
    mask[outer > 0] = cv2.GC_PR_BGD
    mask[rough > 0] = cv2.GC_PR_FGD
    mask[core > 0] = cv2.GC_FGD
    cv2.setRNGSeed(0)
    cv2.grabCut(rgb, mask, None, np.zeros((1,65)), np.zeros((1,65)), 3, cv2.GC_INIT_WITH_MASK)
    matte = np.uint8(np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0))
    subject = image.convert('RGBA')
    subject.putalpha(Image.fromarray(matte).filter(ImageFilter.GaussianBlur(.65)))
    subject = subject.rotate(-13.3, Image.Resampling.BICUBIC, expand=True)
    return subject.crop(subject.getbbox())


def background():
    y, x = np.mgrid[0:1000, 0:1000]
    dark = np.array([211,226,226.])
    light = np.array([247,249,244.])
    amount = np.clip(1 - .45*x/1000 - .24*y/1000, 0, 1)
    noise = np.random.default_rng(7).normal(0, .38, (1000,1000,1))
    rgb = dark*(1-amount[:,:,None]) + light*amount[:,:,None] + noise
    return Image.fromarray(np.uint8(np.clip(rgb,0,255))).convert('RGBA')


def catalog_image(subject):
    canvas = background()
    height, center, base = 744, 500, 892
    image = subject.resize((round(subject.width*height/subject.height), height), RESAMPLE)
    for x,y,w,h,strength,blur in [
        (center+height*.10,base+5,image.width*1.4,height*.080,30,22),
        (center,base-4,image.width*.88,height*.026,160,4),
    ]:
        shadow = Image.new('RGBA', canvas.size)
        ImageDraw.Draw(shadow).ellipse((x-w/2,y-h/2,x+w/2,y+h/2), fill=(10,36,37,strength))
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(image, (round(center-image.width/2), base-height))
    return canvas


# Reuse the actual approved artwork, not regenerated approximations.
for source, target, widths in [
    ('01-desktop-hero.webp', 'hero-desktop', [1800,1200]),
    ('02-mobile-hero.webp', 'hero-mobile', [900,600]),
    ('04-brand-story.webp', 'brand-story', [1200,640]),
    ('05-product-selection.webp', 'product-selection', [1200,640]),
    ('06-quality-macro.webp', 'quality-macro', [1000,600]),
]:
    export(Image.open(REVIEW/source), target, widths)

# Read names from the catalog so inactive/duplicate original artwork is not exported.
catalog = (ROOT/'assets/catalog.js').read_text(encoding='utf-8')
stems = re.findall(r'img:\s*"[^"]*/([^/\"]+)\.webp"', catalog)
assert len(stems) == 13
sources = []
for stem in stems:
    source = ROOT/'img/vials'/f'{stem}.png'
    subject = cutout(source)
    export(catalog_image(subject), f'catalog/{stem}', [800,400])
    sources.append(source.relative_to(ROOT).as_posix())
    print('Exported catalog:', stem)

# A distinct label crop for the lot-review step; no invented COA or lot numbers.
source = Image.open(ROOT/'img/vials/bpc157-5mg.png').convert('RGB')
label_detail = source.crop((425,590,945,980))
export(label_detail, 'label-detail', [520])

(OUT/'provenance.json').write_text(json.dumps({
    'type': 'Composites and crops of supplied product artwork; not new photography',
    'approval': 'User approved imagery-v1 contact sheet in conversation',
    'review': 'design-review/imagery-v1/',
    'sources': sources,
    'processing': 'Background masking, upright rotation, resizing, compositing, and simulated contact shadows. Product lettering is not regenerated.',
    'shipping': 'Existing illustration retained. Actual packaging photos still required.',
    'limitations': 'Glass retains reflections/transmission from original artwork. Composites do not verify label claims or represent a company facility.'
}, indent=2)+'\n', encoding='utf-8')
print('Approved delivery images written to', OUT)
