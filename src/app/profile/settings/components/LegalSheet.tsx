'use client';

import { LEGAL_DOCS, type LegalDocId } from '@/lib/legal-content';

/**
 * Renders one of the five static documents (Help, Guidelines, Safety, Terms,
 * About) from `LEGAL_DOCS`.
 *
 * The copy lives in the data module; this component owns only presentation, so a
 * new section is a data edit and never a layout edit.
 */

export interface LegalSheetProps {
  docId: LegalDocId;
}

export default function LegalSheet({ docId }: LegalSheetProps) {
  const doc = LEGAL_DOCS[docId];

  return (
    <div data-testid={`legal-doc-${docId}`}>
      <p style={{ margin: '0 0 18px', fontSize: '13px', color: 'var(--mr-placeholder, #9b8ba6)', lineHeight: 1.6 }}>
        {doc.subtitle}
      </p>

      {doc.sections.map((section) => (
        <section key={section.heading} style={{ marginBottom: '20px' }}>
          <h3
            style={{
              margin: '0 0 8px',
              fontSize: '15px',
              fontWeight: 800,
              color: 'var(--mr-gold, #d8b38a)',
            }}
          >
            {section.heading}
          </h3>
          {section.body.map((paragraph) => (
            <p
              key={paragraph}
              style={{
                margin: '0 0 8px',
                fontSize: '14px',
                lineHeight: 1.65,
                color: 'var(--mr-heading, #eae2f0)',
              }}
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
