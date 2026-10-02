import math
from PIL import Image, ImageDraw

BG=(15,43,45); AMBER=(231,176,74); TEAL=(127,196,196)

def waves(size, scale, rounded):
    S=size*4
    img=Image.new("RGBA",(S,S),(0,0,0,0))
    d=ImageDraw.Draw(img)
    if rounded: d.rounded_rectangle([0,0,S-1,S-1],radius=int(S*0.22),fill=BG)
    else: d.rectangle([0,0,S,S],fill=BG)
    w=S*scale; x0=(S-w)/2; amp=S*0.045*scale/0.7*0.7; width=int(S*0.068*scale/0.7*0.7)
    for cy,col in ((S*0.41,AMBER),(S*0.62,TEAL)):
        pts=[(x0+w*t/200, cy+amp*math.sin(t/200*2*math.pi*2.2)) for t in range(201)]
        d.line(pts,fill=col,width=width,joint="curve")
        for p in (pts[0],pts[-1]):
            d.ellipse([p[0]-width/2,p[1]-width/2,p[0]+width/2,p[1]+width/2],fill=col)
    return img.resize((size,size),Image.LANCZOS)

waves(512,0.72,True).save("public/icons/icon-512.png")
waves(192,0.72,True).save("public/icons/icon-192.png")
waves(512,0.5,False).save("public/icons/icon-maskable-512.png")
waves(180,0.72,False).save("public/icons/apple-touch-icon.png")
print("ok")
