# Generates migration 884: vendors for the die-casting route processes
# (High Pressure Die Casting, 3 Axis Mill, Manual Deburr, Bench Operation)
# around Bengaluru and Coimbatore, from the user-supplied research list of
# 2026-10-04. Facts only from that list; no website, phone or contact is
# invented. Every row says it is unverified.
#
# Process names are the exact catalog names the Vendors tab searches by
# (vendors.process overlaps the route step names), plus a general term only
# where the list states the capability.
#
# Run: python backend/migrations/scripts/gen_884_seed_vendors_die_casting_route.py
import os
import re

HPDC = ['High Pressure Die Casting', 'Pressure Die Casting', 'Die Casting']
MILL = ['3 Axis Mill', 'CNC Milling']
DEBURR = ['Manual Deburr', 'Deburring']
BENCH = ['Bench Operation']

BLR = ('Bengaluru', 'Karnataka')
CBE = ('Coimbatore', 'Tamil Nadu')
NOTE = 'Unverified: from a 2026-10-04 web research list; confirm process with the vendor.'

# name, area, (city, state), processes, industries, materials, certifications, stated capability
VENDORS = [
    ('Newcast Die Casting Pvt Ltd', 'Peenya', BLR, HPDC + ['CNC Machining'], [], [], [], 'Pressure die-casting machines 120T-650T; CNC/VMC; finishing'),
    ('Hexa', 'Peenya', BLR, HPDC, [], [], [], ''),
    ('DIMO Castings Pvt Ltd', 'Bommasandra', BLR, HPDC + ['CNC Machining'], [], [], [], '20 pressure die-casting machines 180T-660T; 13 VMCs; 18 turning centers'),
    ('Apex Die Casters', 'Bommasandra', BLR, HPDC, ['Automotive', 'Electronics', 'Industrial'], [], [], 'High pressure die casting'),
    ('Lamda Components', '', BLR, HPDC, [], [], [], '11 pressure die-casting machines 250T-800T; components 100 g-8.5 kg (source page titled Landa Components)'),
    ('Rise Die Casting', 'Peenya', BLR, HPDC + ['Gravity Die Casting', 'CNC Machining'] + BENCH, [], [], [], 'HPDC/GDC; CNC machining; sub-assembly (rubber bush/sleeve fitting, steel-ball pressing, dowel-pin operations)'),
    ('Anand Engineering', '', BLR, HPDC + ['CNC Machining'], [], ['Aluminium', 'Zinc'], [], 'Aluminium/zinc pressure die casting; CNC/VMC machining'),
    ('Ethereal Machines', '', BLR, MILL + DEBURR, [], [], [], 'CNC machined parts and components'),
    ('Ayyappa CNC Pvt Ltd', 'Bannerghatta Road', BLR, MILL, [], [], [], '8 CNC VMCs listed for 3-axis machining'),
    ('Shenoy Engineering Pvt. Ltd.', 'Peenya', BLR, MILL + DEBURR + BENCH, [], [], [], ''),
    ('FINE TECH - SIVAPRAKASH', 'Mahadevapura', BLR, MILL + DEBURR + BENCH, [], [], [], ''),
    ('CAM-PRO Technologies', 'Peenya', BLR, MILL, [], [], ['AS9100D'], 'CNC manufacturing; high-mix/low-volume'),
    ('Kamadhenu Technology', 'Peenya', BLR, MILL, [], [], [], 'VMC precision-machined components; one-off/R&D jobs'),
    ('Pranav Dynamics', '', BLR, MILL + DEBURR + BENCH, [], [], [], 'VMC machining; deburring and bench finishing in-house; Helicoil/thread-insert fitment'),
    ('Global Unique Engineering', '', BLR, DEBURR + BENCH, [], [], [], ''),
    ('PS PRESSURE DIE CASTING', 'Peelamedu', CBE, HPDC, [], [], [], ''),
    ('PC DIE Castings', 'Podanur / Malumichampatti', CBE, HPDC, [], [], [], ''),
    ('AGM Die Casting', 'Avarampalayam', CBE, HPDC, [], [], [], ''),
    ('Sudharsan Heavy Engineering Industry', '', CBE, HPDC, [], ['Aluminium'], [], 'HP aluminium die casting incl. an 800-ton machine'),
    ('Sri Balaji Castings', '', CBE, HPDC, [], [], [], 'HPDC 50 g-15 kg; 850-ton machine'),
    ('Eurocast', '', CBE, HPDC + ['CNC Machining'] + DEBURR + BENCH, [], [], [], 'HPDC machines 100T-1000T; in-house machining, finishing and assembly'),
    ('Alumina India Casting', '', CBE, HPDC, [], ['Aluminium'], [], '350-ton aluminium pressure die casting'),
    ('Axis Masters - CNC & Laser Machine Manufacturer in Coimbatore', '', CBE, MILL, [], [], [], ''),
    ('Axis Precision Industries', '', CBE, MILL, [], [], [], ''),
    ('Easytech CNC Machinery Manufacturing', '', CBE, MILL, [], [], [], ''),
    ('SKY CNC', '', CBE, MILL, [], [], [], ''),
    ('Iyalia Engineering Solutions India Private Limited', '', CBE, MILL, [], [], [], ''),
    ('Bharath Technology', '', CBE, MILL, [], [], [], 'YCM vertical machining center; 3-axis CNC surface grinding'),
    ('Kisentra', '', CBE, MILL, [], [], [], '3-axis vertical machining centers'),
    ('Manicka Engineering', '', CBE, MILL + BENCH, [], [], [], 'VMC/HMC machining; secondary processes'),
    ('Rufcan Deburring Solutions', '', CBE, DEBURR, [], [], [], 'Deburring'),
    ('Indoshell Cast', '', CBE, DEBURR + BENCH, [], [], [], 'Machine shop VMC/HMC/turning; ancillary finishing operations'),
    ('Mechinex Automation Pvt. Ltd.', '', CBE, BENCH, [], [], [], ''),
    ('Precicraft Components India Private Limited', '', CBE, BENCH, [], [], [], ''),
]

ORG_OWNER_EMAIL = 'enquiries@emuski.com'


def q(s):
    return "'" + s.replace("'", "''") + "'"


def arr(xs):
    return 'ARRAY[' + ', '.join(q(x) for x in dict.fromkeys(xs)) + ']::text[]' if xs else "'{}'::text[]"


def build():
    codes, names, values = set(), set(), []
    for name, area, (city, state), procs, ind, mats, certs, cap in VENDORS:
        assert name.lower() not in names, name
        names.add(name.lower())
        code = 'VND-' + re.sub(r'[^A-Za-z0-9]', '', name)[:8].upper() + '-S884'
        assert code not in codes, code
        codes.add(code)
        address = ', '.join([p for p in (area, city, state, 'India') if p])
        workshop = f'{cap}. {NOTE}' if cap else NOTE
        values.append(
            f'    ({q(code)}, {q(name)}, {q(address)}, {arr(procs)}, {arr(ind)}, {arr(mats)}, {arr(certs)}, '
            f'{q(workshop)}, {q(city)}, {q(state)})'
        )
    return values


HEADER = f"""-- ============================================================================
-- Migration 884: seed vendors for the die-casting route processes
-- ============================================================================
-- Generated by scripts/gen_884_seed_vendors_die_casting_route.py -- edit the
-- generator, not this file.
--
-- {len(VENDORS)} vendors around Bengaluru and Coimbatore from the user-supplied
-- research list (2026-10-04), so the Vendors tab can match the route steps
-- High Pressure Die Casting, 3 Axis Mill, Manual Deburr and Bench Operation
-- (vendors.process holds those exact step names). Only facts in the list:
-- area, stated machines and capacity, materials, industries, certifications.
-- No website, phone or contact is filled. Every row says it is unverified in
-- manufacturing_workshop (vendors has no verification column).
--
-- Tenancy: vendors are org-scoped (migration 620). The organization and the
-- owning user are looked up live from the org owner email, the same way
-- migration 624 does -- no UUID is hardcoded. A vendor already in that org
-- (same name, any case) is left untouched, so the migration is idempotent.
-- One DO block.
-- ============================================================================

DO $$
DECLARE
    v_org_id   UUID;
    v_owner_id UUID;
    v_added    INTEGER;
BEGIN
    SELECT o.id, o.owner_id INTO v_org_id, v_owner_id
    FROM organizations o
    JOIN auth.users owner ON owner.id = o.owner_id
    WHERE owner.email = {q(ORG_OWNER_EMAIL)};
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No organization found owned by {ORG_OWNER_EMAIL}.';
    END IF;

    INSERT INTO vendors (
        supplier_code, name, addresses, process, industries, materials, certifications,
        manufacturing_workshop, city, state, country, status, vendor_type, user_id, organization_id
    )
    SELECT s.code, s.name, s.address, s.process, s.industries, s.materials, s.certs,
           s.workshop, s.city, s.state, 'India', 'active', 'supplier', v_owner_id, v_org_id
    FROM (VALUES
"""

FOOTER = """
    ) AS s(code, name, address, process, industries, materials, certs, workshop, city, state)
    WHERE NOT EXISTS (
        SELECT 1 FROM vendors v
        WHERE v.organization_id = v_org_id AND lower(v.name) = lower(s.name)
    );
    GET DIAGNOSTICS v_added = ROW_COUNT;
    RAISE NOTICE 'Added % vendors to organization %.', v_added, v_org_id;
END $$;

-- Verify (expect a count per step):
-- SELECT step, count(*) FROM vendors v,
--   unnest(ARRAY['High Pressure Die Casting','3 Axis Mill','Manual Deburr','Bench Operation']) AS step
-- WHERE v.process @> ARRAY[step] AND v.supplier_code LIKE '%-S884' GROUP BY step;
"""

if __name__ == '__main__':
    out = os.path.join(os.path.dirname(__file__), '..', '884_seed_vendors_die_casting_route.sql')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(HEADER + ',\n'.join(build()) + FOOTER)
    print('wrote', os.path.normpath(out), len(VENDORS), 'vendors')
