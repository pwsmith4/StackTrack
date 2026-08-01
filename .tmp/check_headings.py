from docx import Document
p=Document('docs/StackTrack_Goodwill_Development_Overview.docx')
print([x.text for x in p.paragraphs if x.style.name.startswith('Heading')][-20:])
