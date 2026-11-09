# -*- coding: utf-8 -*-
"""
Build script to generate:
1. Markdown: docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE.md
2. Word DOCX: docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE.docx
3. PDF Document: docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE.pdf
"""
import os
import sys
import zipfile
import math
import textwrap
from xml.sax.saxutils import escape

# Import the structured content
sys.path.append(os.path.dirname(__file__))
from forging_doc_content import SECTIONS, DOCUMENT_TITLE, DOCUMENT_SUBTITLE, VERSION, DATE, STATUS, AUTHOR

DOCS_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "planning")
os.makedirs(DOCS_DIR, exist_ok=True)

MD_PATH = os.path.join(DOCS_DIR, "FORGING_MODULE_HLD_LLD_ARCHITECTURE.md")
DOCX_PATH = os.path.join(DOCS_DIR, "FORGING_MODULE_HLD_LLD_ARCHITECTURE.docx")
PDF_PATH = os.path.join(DOCS_DIR, "FORGING_MODULE_HLD_LLD_ARCHITECTURE.pdf")

# ==========================================
# 1. MARKDOWN GENERATOR
# ==========================================
def generate_markdown():
    lines = []
    lines.append(f"# {DOCUMENT_TITLE}")
    lines.append(f"## {DOCUMENT_SUBTITLE}\n")
    lines.append(f"| **Field** | **Value** |")
    lines.append(f"|---|---|")
    lines.append(f"| **Version** | {VERSION} |")
    lines.append(f"| **Date** | {DATE} |")
    lines.append(f"| **Status** | {STATUS} |")
    lines.append(f"| **Author** | {AUTHOR} |\n")
    lines.append("---\n")

    for sec in SECTIONS:
        lines.append(f"## {sec['title']}\n")
        for item in sec["content"]:
            t = item["type"]
            if t == "paragraph":
                lines.append(f"{item['text']}\n")
            elif t == "heading3":
                lines.append(f"### {item['text']}\n")
            elif t == "callout":
                lines.append(f"> [!IMPORTANT] **{item['title']}**\n> " + item['text'].replace('\n', '\n> ') + "\n")
            elif t == "table":
                headers = item["headers"]
                lines.append("| " + " | ".join(headers) + " |")
                lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                for row in item["rows"]:
                    clean_row = [cell.replace("\n", "<br>") for cell in row]
                    lines.append("| " + " | ".join(clean_row) + " |")
                lines.append("")
            elif t == "code":
                lines.append(f"```{item.get('language', '')}")
                lines.append(item["text"])
                lines.append("```\n")

    content = "\n".join(lines)
    with open(MD_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Generated Markdown: {MD_PATH} ({len(content)} chars)")

# ==========================================
# 2. DOCX OPENXML GENERATOR
# ==========================================
def generate_docx():
    body_xml = []

    # Title & Subtitle
    body_xml.append(f'''
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
        <w:jc w:val="center"/>
        <w:spacing w:before="240" w:after="120"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b/>
          <w:color w:val="1E3A8A"/>
          <w:sz w:val="48"/>
          <w:szCs w:val="48"/>
        </w:rPr>
        <w:t>{escape(DOCUMENT_TITLE)}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Subtitle"/>
        <w:jc w:val="center"/>
        <w:spacing w:after="360"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:color w:val="475569"/>
          <w:sz w:val="28"/>
        </w:rPr>
        <w:t>{escape(DOCUMENT_SUBTITLE)}</w:t>
      </w:r>
    </w:p>
    ''')

    # Metadata Table
    meta_rows = [
        ("Version", VERSION),
        ("Date", DATE),
        ("Status", STATUS),
        ("Author", AUTHOR)
    ]
    meta_tbl = ['<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="none"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="none"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr>']
    for k, v in meta_rows:
        meta_tbl.append(f'''
        <w:tr>
          <w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/></w:tcPr>
            <w:p><w:r><w:rPr><w:b/><w:color w:val="1E293B"/></w:rPr><w:t>{escape(k)}</w:t></w:r></w:p>
          </w:tc>
          <w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>
            <w:p><w:r><w:t>{escape(v)}</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
        ''')
    meta_tbl.append('</w:tbl>')
    body_xml.append(''.join(meta_tbl))
    body_xml.append('<w:p><w:pPr><w:spacing w:after="240"/></w:pPr></w:p>')

    for sec in SECTIONS:
        # Section Heading
        body_xml.append(f'''
        <w:p>
          <w:pPr>
            <w:pStyle w:val="Heading1"/>
            <w:spacing w:before="360" w:after="140"/>
          </w:pPr>
          <w:r>
            <w:rPr>
              <w:b/>
              <w:color w:val="1E3A8A"/>
              <w:sz w:val="32"/>
            </w:rPr>
            <w:t>{escape(sec["title"])}</w:t>
          </w:r>
        </w:p>
        ''')

        for item in sec["content"]:
            t = item["type"]
            if t == "paragraph":
                for line in item["text"].split("\n"):
                    if not line.strip():
                        continue
                    body_xml.append(f'''
                    <w:p>
                      <w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>
                      <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>{escape(line)}</w:t></w:r>
                    </w:p>
                    ''')
            elif t == "heading3":
                body_xml.append(f'''
                <w:p>
                  <w:pPr>
                    <w:pStyle w:val="Heading2"/>
                    <w:spacing w:before="240" w:after="80"/>
                  </w:pPr>
                  <w:r>
                    <w:rPr><w:b/><w:color w:val="2563EB"/><w:sz w:val="26"/></w:rPr>
                    <w:t>{escape(item["text"])}</w:t>
                  </w:r>
                </w:p>
                ''')
            elif t == "callout":
                body_xml.append(f'''
                <w:p>
                  <w:pPr>
                    <w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="2563EB"/></w:pBdr>
                    <w:shd w:val="clear" w:color="auto" w:fill="EFF6FF"/>
                    <w:spacing w:before="120" w:after="120"/>
                    <w:ind w:left="240" w:right="240"/>
                  </w:pPr>
                  <w:r><w:rPr><w:b/><w:color w:val="1E40AF"/><w:sz w:val="22"/></w:rPr><w:t>{escape(item["title"])}: </w:t></w:r>
                  <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>{escape(item["text"])}</w:t></w:r>
                </w:p>
                ''')
            elif t == "table":
                headers = item["headers"]
                rows = item["rows"]
                col_width = str(int(9000 / len(headers)))
                tbl = ['<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/><w:left w:val="none"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/><w:right w:val="none"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr>']
                # Header row
                tbl.append('<w:tr><w:trPr><w:tblHeader/></w:trPr>')
                for h in headers:
                    tbl.append(f'''
                    <w:tc>
                      <w:tcPr><w:tcW w:w="{col_width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="1E3A8A"/></w:tcPr>
                      <w:p><w:pPr><w:spacing w:before="80" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr><w:t>{escape(h)}</w:t></w:r></w:p>
                    </w:tc>''')
                tbl.append('</w:tr>')
                # Data rows
                for r_idx, row in enumerate(rows):
                    fill_color = "F8FAFC" if (r_idx % 2 == 1) else "FFFFFF"
                    tbl.append('<w:tr>')
                    for cell in row:
                        tbl.append(f'''
                        <w:tc>
                          <w:tcPr><w:tcW w:w="{col_width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="{fill_color}"/></w:tcPr>
                          <w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>{escape(cell)}</w:t></w:r></w:p>
                        </w:tc>''')
                    tbl.append('</w:tr>')
                tbl.append('</w:tbl>')
                body_xml.append(''.join(tbl))
                body_xml.append('<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>')
            elif t == "code":
                code_lines = item["text"].split("\n")
                tbl = ['<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="0F172A"/></w:tcPr>']
                for cl in code_lines:
                    tbl.append(f'<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:color w:val="38BDF8"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">{escape(cl)}</w:t></w:r></w:p>')
                tbl.append('</w:tc></w:tr></w:tbl>')
                body_xml.append(''.join(tbl))
                body_xml.append('<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>')

    doc_xml_str = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {''.join(body_xml)}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>'''

    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''

    rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

    with zipfile.ZipFile(DOCX_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc_xml_str)
    print(f"Generated DOCX: {DOCX_PATH} ({os.path.getsize(DOCX_PATH)} bytes)")

# ==========================================
# 3. PURE PYTHON PDF GENERATOR (PDF 1.4)
# ==========================================
class SimplePDFBuilder:
    def __init__(self):
        self.pages = []
        self.current_page_ops = []
        self.width = 612.0   # 8.5 x 11 inches (Letter)
        self.height = 792.0
        self.margin = 54.0   # 0.75 inch
        self.content_width = self.width - 2 * self.margin
        self.y = self.height - self.margin
        self.current_page_number = 1

    def new_page(self):
        if self.current_page_ops:
            self.pages.append(self.current_page_ops)
        self.current_page_ops = []
        self.y = self.height - self.margin
        self.current_page_number += 1

    def check_space(self, needed):
        if self.y - needed < self.margin + 30:
            self.new_page()

    def add_op(self, op):
        self.current_page_ops.append(op)

    def draw_text(self, text, x, y, font="F1", size=10, r=0.1, g=0.1, b=0.1):
        clean_text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        self.add_op(f"BT /{font} {size} Tf {r:.3f} {g:.3f} {b:.3f} rg {x:.2f} {y:.2f} Td ({clean_text}) Tj ET")

    def draw_rect(self, x, y, w, h, fill_rgb=None, stroke_rgb=None, line_width=1):
        if fill_rgb:
            r, g, b = fill_rgb
            self.add_op(f"{r:.3f} {g:.3f} {b:.3f} rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")
        if stroke_rgb:
            r, g, b = stroke_rgb
            self.add_op(f"{line_width} w {r:.3f} {g:.3f} {b:.3f} RG {x:.2f} {y:.2f} {w:.2f} {h:.2f} re S")

    def add_paragraph(self, text, font="F1", size=9.5, leading=13.5, r=0.15, g=0.2, b=0.25):
        chars_per_line = int(self.content_width / (size * 0.52))
        for raw_line in text.split("\n"):
            if not raw_line.strip():
                self.y -= leading * 0.5
                continue
            wrapped_lines = textwrap.wrap(raw_line, width=chars_per_line)
            for wline in wrapped_lines:
                self.check_space(leading)
                self.draw_text(wline, self.margin, self.y, font=font, size=size, r=r, g=g, b=b)
                self.y -= leading
        self.y -= 4

    def add_heading1(self, text):
        self.check_space(38)
        self.y -= 10
        self.draw_rect(self.margin, self.y - 4, self.content_width, 24, fill_rgb=(0.94, 0.96, 0.99))
        self.draw_rect(self.margin, self.y - 4, 4, 24, fill_rgb=(0.12, 0.23, 0.54))
        self.draw_text(text, self.margin + 12, self.y + 3, font="F2", size=12, r=0.12, g=0.23, b=0.54)
        self.y -= 26

    def add_heading2(self, text):
        self.check_space(26)
        self.y -= 8
        self.draw_text(text, self.margin, self.y, font="F2", size=10.5, r=0.15, g=0.35, b=0.75)
        self.y -= 16

    def add_callout(self, title, text):
        box_text = f"{title}: {text}"
        chars_per_line = int((self.content_width - 24) / (9 * 0.52))
        lines = []
        for rl in box_text.split("\n"):
            lines.extend(textwrap.wrap(rl, width=chars_per_line))
        box_height = len(lines) * 12.5 + 16
        self.check_space(box_height + 10)
        self.draw_rect(self.margin, self.y - box_height, self.content_width, box_height, fill_rgb=(0.94, 0.96, 1.0), stroke_rgb=(0.75, 0.85, 0.98), line_width=1)
        self.draw_rect(self.margin, self.y - box_height, 4, box_height, fill_rgb=(0.15, 0.38, 0.92))
        cur_y = self.y - 14
        for l in lines:
            self.draw_text(l, self.margin + 14, cur_y, font="F1", size=8.5, r=0.1, g=0.2, b=0.45)
            cur_y -= 12.5
        self.y -= (box_height + 12)

    def add_code_block(self, code_str):
        code_lines = code_str.split("\n")
        line_height = 10.0
        idx = 0
        while idx < len(code_lines):
            available_lines = int((self.y - self.margin - 40) / line_height)
            if available_lines < 5:
                self.new_page()
                available_lines = int((self.y - self.margin - 40) / line_height)
            
            chunk = code_lines[idx : idx + available_lines]
            chunk_h = len(chunk) * line_height + 12
            self.draw_rect(self.margin, self.y - chunk_h, self.content_width, chunk_h, fill_rgb=(0.06, 0.09, 0.16), stroke_rgb=(0.2, 0.25, 0.35), line_width=0.8)
            cur_y = self.y - 12
            for cl in chunk:
                disp = cl[:88]
                self.draw_text(disp, self.margin + 10, cur_y, font="F3", size=7.5, r=0.22, g=0.74, b=0.97)
                cur_y -= line_height
            self.y -= (chunk_h + 10)
            idx += available_lines

    def add_table(self, headers, rows):
        n_cols = len(headers)
        col_w = self.content_width / n_cols
        row_h = 18.0
        
        calc_rows = []
        for r in rows:
            max_lines = 1
            wrapped_cells = []
            for c in r:
                c_lines = textwrap.wrap(c, width=int(col_w / 4.8))
                if not c_lines: c_lines = [""]
                max_lines = max(max_lines, len(c_lines))
                wrapped_cells.append(c_lines)
            calc_rows.append((wrapped_cells, max_lines * 10.5 + 8))

        self.check_space(row_h + calc_rows[0][1] + 10)

        # Header
        self.draw_rect(self.margin, self.y - row_h, self.content_width, row_h, fill_rgb=(0.12, 0.23, 0.54))
        for c_idx, h in enumerate(headers):
            self.draw_text(h[:26], self.margin + c_idx * col_w + 4, self.y - 12, font="F2", size=7.5, r=1.0, g=1.0, b=1.0)
        self.y -= row_h

        # Rows
        for r_idx, (wcells, h_needed) in enumerate(calc_rows):
            self.check_space(h_needed + 4)
            fill_c = (0.97, 0.98, 0.99) if (r_idx % 2 == 1) else (1.0, 1.0, 1.0)
            self.draw_rect(self.margin, self.y - h_needed, self.content_width, h_needed, fill_rgb=fill_c, stroke_rgb=(0.88, 0.91, 0.94), line_width=0.5)
            for c_idx, clines in enumerate(wcells):
                cell_y = self.y - 10
                for line in clines:
                    self.draw_text(line, self.margin + c_idx * col_w + 4, cell_y, font="F1", size=7.0, r=0.15, g=0.2, b=0.25)
                    cell_y -= 10.0
            self.y -= h_needed
        self.y -= 10

    def compile(self, output_path):
        if self.current_page_ops:
            self.pages.append(self.current_page_ops)

        total_pages = len(self.pages)
        for p_idx, ops in enumerate(self.pages):
            page_num_str = f"eMithran Confidential  |  Forging Architecture Specification  |  Page {p_idx + 1} of {total_pages}"
            clean = page_num_str.replace("(", "\\(").replace(")", "\\)")
            ops.append(f"0.5 w 0.8 0.85 0.9 RG {self.margin:.2f} 38.00 {self.content_width:.2f} 0.00 re S")
            ops.append(f"BT /F1 7.5 Tf 0.45 0.52 0.6 rg {self.margin:.2f} 26.00 Td ({clean}) Tj ET")

        objects = []
        objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
        page_refs = [f"{4 + i * 2} 0 R" for i in range(total_pages)]
        pages_dict = f"<< /Type /Pages /Kids [{' '.join(page_refs)}] /Count {total_pages} >>".encode("ascii")
        objects.append(pages_dict)
        fonts_dict = b"""<<
  /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
  /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
  /F3 << /Type /Font /Subtype /Type1 /BaseFont /Courier >>
>>"""
        objects.append(fonts_dict)

        for p_idx, ops in enumerate(self.pages):
            stream_data = "\n".join(ops).encode("latin1", "replace")
            page_obj = f"""<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 {self.width:.2f} {self.height:.2f}]
  /Contents {5 + p_idx * 2} 0 R
  /Resources << /Font 3 0 R >>
>>""".encode("ascii")
            objects.append(page_obj)
            content_obj = f"<< /Length {len(stream_data)} >>\nstream\n".encode("ascii") + stream_data + b"\nendstream"
            objects.append(content_obj)

        pdf_out = bytearray()
        pdf_out.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        xref_offsets = []
        for i, obj in enumerate(objects):
            xref_offsets.append(len(pdf_out))
            pdf_out.extend(f"{i+1} 0 obj\n".encode("ascii"))
            pdf_out.extend(obj)
            pdf_out.extend(b"\nendobj\n")

        xref_pos = len(pdf_out)
        pdf_out.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode("ascii"))
        for off in xref_offsets:
            pdf_out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
        pdf_out.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii"))

        with open(output_path, "wb") as f:
            f.write(pdf_out)
        print(f"Generated PDF: {output_path} ({len(pdf_out)} bytes, {total_pages} pages)")

def generate_pdf():
    pdf = SimplePDFBuilder()
    
    # Title Block
    pdf.draw_text(DOCUMENT_TITLE, pdf.margin, pdf.y, font="F2", size=15, r=0.12, g=0.23, b=0.54)
    pdf.y -= 20
    pdf.draw_text(DOCUMENT_SUBTITLE, pdf.margin, pdf.y, font="F1", size=10.5, r=0.3, g=0.35, b=0.45)
    pdf.y -= 18

    # Metadata Table
    meta_headers = ["Document Attribute", "Specification Details"]
    meta_rows = [
        ["Version & Status", f"{VERSION} ({STATUS})"],
        ["Publication Date", DATE],
        ["Target Architecture", "eMithran NestJS Monolith + OpenCASCADE cad-engine + PostgreSQL RLS"],
        ["Document Owner", AUTHOR]
    ]
    pdf.add_table(meta_headers, meta_rows)
    pdf.y -= 10

    for sec in SECTIONS:
        pdf.add_heading1(sec["title"])
        for item in sec["content"]:
            t = item["type"]
            if t == "paragraph":
                pdf.add_paragraph(item["text"])
            elif t == "heading3":
                pdf.add_heading2(item["text"])
            elif t == "callout":
                pdf.add_callout(item["title"], item["text"])
            elif t == "table":
                pdf.add_table(item["headers"], item["rows"])
            elif t == "code":
                pdf.add_code_block(item["text"])

    pdf.compile(PDF_PATH)

if __name__ == "__main__":
    generate_markdown()
    generate_docx()
    generate_pdf()
