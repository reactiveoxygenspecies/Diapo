"""Builds sample.pptx next to this file: two slides that exercise the importer
(placeholders inheriting their position from the layout, a subtitle, a picture,
bullets with levels, a table, an ellipse, a coloured run, speaker notes).
Run with: py -3 make_pptx.py"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "sample.pptx")

A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

CONTENT_TYPES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/notesSlides/notesSlide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"""

PRESENTATION = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation {P} {A} {R}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"""

PRESENTATION_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>"""

def ph(idx, typ, x, y, w, h, name):
    t = f' type="{typ}"' if typ else ""
    i = f' idx="{idx}"' if idx is not None else ""
    return f"""<p:sp><p:nvSpPr><p:cNvPr id="{idx or 1}" name="{name}"/><p:cNvSpPr/><p:nvPr><p:ph{t}{i}/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>"""

MASTER = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster {P} {A} {R}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
{ph(None, "title", 838200, 365125, 10515600, 1325563, "Title")}
{ph(1, "body", 838200, 1825625, 10515600, 4351338, "Body")}
</p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>"""
MASTER_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"""

LAYOUT = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout {P} {A} {R} type="title"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
{ph(None, "ctrTitle", 1524000, 1122363, 9144000, 2387600, "Title")}
{ph(1, "subTitle", 1524000, 3602038, 9144000, 1655762, "Subtitle")}
</p:spTree></p:cSld></p:sldLayout>"""
LAYOUT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"""

# Slide 1: title placeholder WITHOUT its own position (inherits from the layout), a subtitle with one, a picture.
SLIDE1 = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld {P} {A} {R}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr anchor="b"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="6000" b="1"/><a:t>PowerPoint import</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:cNvSpPr/><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1524000" y="3602038"/><a:ext cx="9144000" cy="1655762"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:pPr algn="ctr"><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" sz="2400"/><a:t>A subtitle with </a:t></a:r><a:r><a:rPr lang="en-US" sz="2400" i="1"><a:solidFill><a:srgbClr val="E8503F"/></a:solidFill></a:rPr><a:t>colour</a:t></a:r></a:p></p:txBody></p:sp>
<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="9144000" y="4572000"/><a:ext cx="1524000" cy="1524000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>
</p:spTree></p:cSld></p:sld>"""
SLIDE1_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>"""

# Slide 2: title with a position, body bullets (two levels, one buNone paragraph), a table, an ellipse, notes.
SLIDE2 = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld {P} {A} {R}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F4F4F5"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Bullets and a table</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="5000000" cy="4351338"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/>
<a:p><a:r><a:rPr lang="en-US"/><a:t>First point</a:t></a:r></a:p>
<a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Nested point</a:t></a:r></a:p>
<a:p><a:r><a:rPr lang="en-US"/><a:t>Second point</a:t></a:r></a:p>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>A plain closing line</a:t></a:r></a:p>
</p:txBody></p:sp>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="6400000" y="1825625"/><a:ext cx="4953600" cy="1000000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="2476800"/><a:gridCol w="2476800"/></a:tblGrid>
<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Name</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>alpha</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>1</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="Oval 4"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="6400000" y="3200000"/><a:ext cx="1524000" cy="1524000"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld></p:sld>"""
SLIDE2_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>
</Relationships>"""
NOTES2 = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes {P} {A} {R}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Say something about the table.</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>"""

# A 16x16 red PNG, built here so the file is valid.
def make_png(w=16, h=16, rgb=(232, 80, 63)):
    import struct, zlib
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    raw = b"".join(bytes([0]) + bytes(rgb) * w for _ in range(h))
    sig = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    return sig + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
PNG = make_png()

def main():
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("ppt/presentation.xml", PRESENTATION)
        z.writestr("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS)
        z.writestr("ppt/slideMasters/slideMaster1.xml", MASTER)
        z.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", MASTER_RELS)
        z.writestr("ppt/slideLayouts/slideLayout1.xml", LAYOUT)
        z.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", LAYOUT_RELS)
        z.writestr("ppt/slides/slide1.xml", SLIDE1)
        z.writestr("ppt/slides/_rels/slide1.xml.rels", SLIDE1_RELS)
        z.writestr("ppt/slides/slide2.xml", SLIDE2)
        z.writestr("ppt/slides/_rels/slide2.xml.rels", SLIDE2_RELS)
        z.writestr("ppt/notesSlides/notesSlide2.xml", NOTES2)
        z.writestr("ppt/media/image1.png", PNG)
    print("wrote", OUT)

if __name__ == "__main__":
    main()
