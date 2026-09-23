"""Approval-only composition studies, not generative photographs.
Reads original product artwork; never modifies website files or source assets.
Requires Pillow, NumPy, and OpenCV. Outputs are confined to this directory.
"""
from pathlib import Path
import math
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'concepts'
OUT.mkdir(exist_ok=True)
FONT = Path('C:/Windows/Fonts')
TEAL = '#00474b'
INK = '#073e43'
ICE = '#edf6f7'

def font(size, bold=False, serif=False):
    name = 'georgia.ttf' if serif else ('arialbd.ttf' if bold else 'arial.ttf')
    return ImageFont.truetype(str(FONT / name), size)

def label(draw, xy, text, size=20, fill=INK, bold=False):
    draw.text(xy, text, font=font(size, bold), fill=fill)

def background(size, dark=False):
    w,h=size
    y,x=np.mgrid[0:h,0:w]
    if dark:
        a=np.array([0,57,62.]);b=np.array([64,113,114.])
        light=np.exp(-(((x-w*.86)/(w*.48))**2+((y-h*.25)/(h*.82))**2))*0.82
    else:
        a=np.array([211,226,226.]);b=np.array([247,249,244.])
        light=np.clip(1-0.45*x/w-0.24*y/h,0,1)
    noise=np.random.default_rng(7).normal(0,.38,(h,w,1))
    rgb=a[None,None,:]*(1-light[:,:,None])+b[None,None,:]*light[:,:,None]+noise
    return Image.fromarray(np.uint8(np.clip(rgb,0,255))).convert('RGBA')

def shadow(canvas, center, width, height, strength=60, blur=20):
    lay=Image.new('RGBA',canvas.size)
    d=ImageDraw.Draw(lay);x,y=center
    d.ellipse((x-width/2,y-height/2,x+width/2,y+height/2), fill=(10,36,37,strength))
    canvas.alpha_composite(lay.filter(ImageFilter.GaussianBlur(blur)))

def cutout(filename):
    original=Image.open(ROOT/'img/vials'/filename).convert('RGB')
    rgb=np.array(original)
    # Hand-traced outer silhouette around the supplied artwork, refined only at edges.
    points=np.array([(349,306),(366,279),(405,249),(454,227),(506,211),(562,204),(607,208),(649,220),(675,238),(686,259),(709,349),(715,376),(709,400),(694,420),(712,445),(730,466),(745,489),(761,518),(880,918),(889,949),(885,978),(870,1007),(838,1035),(800,1056),(752,1073),(702,1087),(650,1095),(602,1094),(565,1086),(541,1073),(523,1053),(515,1029),(411,585),(409,559),(417,530),(431,506),(437,493),(412,490),(392,473),(379,450),(368,418),(353,398),(348,382),(339,350),(340,326)],np.int32)
    rough=np.zeros(rgb.shape[:2],np.uint8);cv2.fillPoly(rough,[points],255)
    core=cv2.erode(rough,np.ones((17,17),np.uint8))
    outer=cv2.dilate(rough,np.ones((17,17),np.uint8))
    mask=np.full(rough.shape,cv2.GC_BGD,np.uint8)
    mask[outer>0]=cv2.GC_PR_BGD;mask[rough>0]=cv2.GC_PR_FGD;mask[core>0]=cv2.GC_FGD
    cv2.grabCut(rgb,mask,None,np.zeros((1,65)),np.zeros((1,65)),3,cv2.GC_INIT_WITH_MASK)
    matte=np.uint8(np.where((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD),255,0))
    # Preserve the glass and all label pixels; no inpainting or label regeneration.
    alpha=Image.fromarray(matte).filter(ImageFilter.GaussianBlur(.65))
    image=original.convert('RGBA');image.putalpha(alpha)
    image=image.rotate(-13.3,Image.Resampling.BICUBIC,expand=True)
    return image.crop(image.getbbox())

VIALS={name:cutout(file) for name,file in [('tirzepatide','tirzepatide-10mg.png'),('semaglutide','semaglutide-5mg.png'),('bpc157','bpc157-5mg.png')]}

def vial(canvas,name,height,center,base):
    im=VIALS[name].copy()
    im=im.resize((round(im.width*height/im.height),height),Image.Resampling.LANCZOS)
    x=round(center-im.width/2);y=round(base-height)
    shadow(canvas,(center+height*.10,base+5),im.width*1.4,height*.080,30,max(10,int(height*.030)))
    shadow(canvas,(center,base-4),im.width*.88,height*.026,160,max(2,int(height*.006)))
    canvas.alpha_composite(im,(x,y))

def save(image,name):
    image.convert('RGB').save(OUT/name,'WEBP',quality=92,method=6)

# A — Desktop. Pale stone support is deliberately a simple layout-study surface.
hero=background((1800,960),True)
d=ImageDraw.Draw(hero)
d.polygon([(965,731),(1480,620),(1800,707),(1800,960),(850,960)],fill='#d5ded7')
d.polygon([(965,731),(1480,620),(1800,707),(1300,850)],fill='#e9eee6')
d.polygon([(1300,850),(1800,707),(1800,960),(1300,960)],fill='#c7d4ce')
vial(hero,'bpc157',401,1525,740)
vial(hero,'semaglutide',460,1130,760)
vial(hero,'tirzepatide',560,1340,802)
save(hero,'01-desktop-hero.webp')

# B — Independently composed portrait, top half reserved for live website content.
mobile=background((900,1440),True)
d=ImageDraw.Draw(mobile)
d.polygon([(180,1198),(740,1100),(900,1143),(900,1440),(0,1440),(0,1250)],fill='#e1e7df')
d.polygon([(180,1198),(740,1100),(900,1143),(342,1320),(0,1250)],fill='#eff1e9')
d.polygon([(342,1320),(900,1143),(900,1440),(342,1440)],fill='#cbd8d0')
vial(mobile,'semaglutide',315,349,1243)
vial(mobile,'tirzepatide',408,576,1218)
save(mobile,'02-mobile-hero.webp')

# C — Same scale and position across the sample catalog set.
for name in VIALS:
    catalog=background((1000,1000))
    vial(catalog,name,744,500,892)
    save(catalog,'03-catalog-'+name+'.webp')

# D — An editorial product still life instead of an invented facility photograph.
story=background((1200,900))
d=ImageDraw.Draw(story)
d.polygon([(0,0),(245,0),(570,900),(325,900)],fill=(233,241,237,255))
d.polygon([(763,635),(1200,574),(1200,900),(763,900)],fill='#d1ded7')
d.polygon([(648,591),(1080,537),(1200,574),(763,635)],fill='#f2f3eb')
d.polygon([(648,591),(763,635),(763,900),(648,845)],fill='#e0e5dc')
vial(story,'semaglutide',465,927,599)
vial(story,'tirzepatide',586,442,808)
save(story,'04-brand-story.webp')

# E — Product selection; deliberately distinct from the hero cluster.
selection=background((1200,900))
for name,x in [('semaglutide',276),('tirzepatide',598),('bpc157',921)]:
    vial(selection,name,550,x,753)
save(selection,'05-product-selection.webp')

# F — Actual source pixels at macro scale, cropped rather than redrawn.
macro=background((1000,1200),True)
subject=VIALS['tirzepatide'].resize((round(VIALS['tirzepatide'].width*1.65),round(VIALS['tirzepatide'].height*1.65)),Image.Resampling.LANCZOS)
macro.alpha_composite(subject,(105,40))
save(macro,'06-quality-macro.webp')

# G — Photography brief, not invented shipping packaging.
shipping=background((1200,900))
d=ImageDraw.Draw(shipping)
d.rounded_rectangle((90,110,1110,790),radius=5,outline='#9eb6b4',width=2)
label(d,(145,166),'SHIPPING PHOTOGRAPHY',23,bold=True)
label(d,(145,227),'Actual packaging needed.',46,bold=True)
lines=['No packaging has been invented for this proposal.','Please supply:','01   The actual outer carton','02   The open box and protective insert','03   A packed order, with personal details covered']
for i,line in enumerate(lines):label(d,(145,342+i*66),line,25,fill='#4d6d71')
save(shipping,'07-shipping-photo-brief.webp')

# A source panel makes provenance apparent at first glance.
source=Image.new('RGB',(1200,450),'#e6efed')
d=ImageDraw.Draw(source)
for i,(name,file) in enumerate([('SEMAGLUTIDE','semaglutide-5mg.png'),('TIRZEPATIDE','tirzepatide-10mg.png'),('BPC-157','bpc157-5mg.png')]):
    im=Image.open(ROOT/'img/vials'/file).resize((350,350),Image.Resampling.LANCZOS)
    source.paste(im,(i*400+25,20));label(d,(i*400+25,385),name,19,bold=True)
save(source,'00-supplied-artwork.webp')

# Contact sheet: large enough to judge labels and lighting on a desktop.
W,H=1600,2700
sheet=Image.new('RGB',(W,H),'#f2f6f3');d=ImageDraw.Draw(sheet)
label(d,(60,38),'HELLO YOU LABS  /  IMAGE DIRECTION 01',17,bold=True)
label(d,(60,82),'Black & gold. A lighter setting.',51,bold=True)
label(d,(60,156),'Approval-only composition studies using your existing product artwork.',23,fill='#4d6d71')
label(d,(60,190),'No new photography or generative-image model used. Website unchanged.',19,fill='#4d6d71')

def tile(image_name,box,title,classification,caption,fit='cover'):
    x,y,w,h=box
    im=Image.open(OUT/image_name).convert('RGB')
    if fit=='contain':
        fitted=ImageOps.contain(im,(w,h),Image.Resampling.LANCZOS)
        sheet.paste('#dfe9e5',(x,y,x+w,y+h));sheet.paste(fitted,(x+(w-fitted.width)//2,y+(h-fitted.height)//2))
    else:sheet.paste(ImageOps.fit(im,(w,h),Image.Resampling.LANCZOS,centering=(.5,1 if fit=='bottom' else .5)),(x,y))
    label(d,(x,y+h+13),title,24,bold=True)
    label(d,(x,y+h+46),classification,15,fill='#006d75',bold=True)
    label(d,(x,y+h+73),caption,17,fill='#4d6d71')

tile('01-desktop-hero.webp',(60,260,1480,560),'01  Desktop hero','COMPOSITE + PROCEDURAL SURFACE','Three original vials. Teal text-safe space. Pale architectural support.')
tile('02-mobile-hero.webp',(60,964,430,660),'02  Mobile hero','COMPOSITE / PORTRAIT STUDY','A separate crop, not a squeezed desktop image.')
tile('03-catalog-tirzepatide.webp',(540,964,460,460),'03  Catalog treatment','ORIGINAL VIAL / NEW BACKGROUND','One scale. One light-blue setting.')
tile('00-supplied-artwork.webp',(1040,964,500,460),'Source of truth','SUPPLIED PRODUCT ARTWORK','Your labels, never regenerated.',fit='contain')
label(d,(540,1554),'READ BEFORE APPROVING',16,bold=True)
label(d,(540,1586),'These are layout studies, not finished photographs.',20)
label(d,(540,1617),'Dark glass pixels remain from the supplied artwork.',18,fill='#4d6d71')
label(d,(540,1647),'True transmitted light needs a new product shoot.',18,fill='#4d6d71')

tile('04-brand-story.webp',(60,1758,470,350),'04  Brand story','COMPOSITE + PROCEDURAL SURFACE','Product-first. No fictional facility.')
tile('05-product-selection.webp',(565,1758,470,350),'05  Product selection','COMPOSITE / ORIGINAL VIALS','A quieter, consistent collection view.')
tile('06-quality-macro.webp',(1070,1758,470,350),'06  Quality detail','MACRO CROP / COMPOSITE','Source glass and cap, not new claims.')

# Bottom approval note instead of presenting a fictional packaging photo.
d.line((60,2275,1540,2275),fill='#b9ceca',width=2)
label(d,(60,2309),'07  Shipping: hold for your actual packaging photos.',29,bold=True)
label(d,(60,2360),'Need: outer carton, open insert, and one packed order with personal details removed.',21,fill='#4d6d71')
label(d,(60,2420),'RECOMMENDED NEXT STEP',16,bold=True)
label(d,(60,2456),'Approve the composition and palette; use a real product shoot for final hero glass.',24)
label(d,(60,2503),'Production prompts and a photo checklist accompany this board.',21,fill='#4d6d71')
label(d,(60,2608),'NO WEBSITE FILES MODIFIED   /   NO NEW PRODUCT TEXT   /   NO STOCK PEOPLE OR FACILITIES',14,fill='#4d6d71',bold=True)
sheet.save(HERE/'contact-sheet.jpg',quality=94,subsampling=0)
print('Created approval-only images and contact-sheet.jpg in',HERE)
