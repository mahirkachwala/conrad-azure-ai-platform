/**
 * OEM Product Datasheets Repository
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * Contains comprehensive product datasheets from OEM cable manufacturer.
 * This data is used by the Technical Agent for SKU matching.
 * 
 * Source: Based on specifications from leading cable manufacturers
 * (Polycab, Havells, KEI Industries, Finolex)
 */

export const OEM_PRODUCT_CATALOG = {
  metadata: {
    source: "OEM Cable Manufacturer Product Catalog",
    version: "2.0",
    last_updated: "2025-11-28",
    manufacturer: "EY Techathon Demo OEM",
    description: "Comprehensive product datasheets for wires and cables"
  },
  
  products: [
    // =====================================================
    // HT (HIGH TENSION) POWER CABLES - 11kV
    // =====================================================
    {
      sku_id: "HT-CU-XLPE-3C-95",
      product_name: "3 Core 95 sq.mm Copper XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 95,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 280,
        short_circuit_rating_ka: 18.5,
        min_bending_radius_mm: 760,
        overall_diameter_mm: 58.2,
        weight_kg_per_km: 4850,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Industrial Plants", "Substations"],
      unit_price_inr_per_km: 785000,
      lead_time_days: 21
    },
    {
      sku_id: "HT-CU-XLPE-3C-120",
      product_name: "3 Core 120 sq.mm Copper XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 120,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 320,
        short_circuit_rating_ka: 23.4,
        min_bending_radius_mm: 820,
        overall_diameter_mm: 62.5,
        weight_kg_per_km: 5650,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Industrial Plants", "Substations"],
      unit_price_inr_per_km: 925000,
      lead_time_days: 21
    },
    {
      sku_id: "HT-CU-XLPE-3C-185",
      product_name: "3 Core 185 sq.mm Copper XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 185,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 405,
        short_circuit_rating_ka: 36.1,
        min_bending_radius_mm: 920,
        overall_diameter_mm: 71.8,
        weight_kg_per_km: 7250,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Industrial Plants", "Substations"],
      unit_price_inr_per_km: 1285000,
      lead_time_days: 25
    },
    {
      sku_id: "HT-CU-XLPE-3C-240",
      product_name: "3 Core 240 sq.mm Copper XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 240,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 475,
        short_circuit_rating_ka: 46.8,
        min_bending_radius_mm: 1020,
        overall_diameter_mm: 79.5,
        weight_kg_per_km: 8850,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Heavy Industrial", "Substations"],
      unit_price_inr_per_km: 1585000,
      lead_time_days: 28
    },
    {
      sku_id: "HT-AL-XLPE-3C-95",
      product_name: "3 Core 95 sq.mm Aluminium XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 95,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 215,
        short_circuit_rating_ka: 12.4,
        min_bending_radius_mm: 720,
        overall_diameter_mm: 56.8,
        weight_kg_per_km: 3420,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Industrial Plants", "Overhead Lines"],
      unit_price_inr_per_km: 485000,
      lead_time_days: 18
    },
    {
      sku_id: "HT-AL-XLPE-3C-120",
      product_name: "3 Core 120 sq.mm Aluminium XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 120,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 250,
        short_circuit_rating_ka: 15.6,
        min_bending_radius_mm: 780,
        overall_diameter_mm: 61.2,
        weight_kg_per_km: 4050,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Industrial Plants"],
      unit_price_inr_per_km: 565000,
      lead_time_days: 18
    },
    {
      sku_id: "HT-AL-XLPE-3C-185",
      product_name: "3 Core 185 sq.mm Aluminium XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 185,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 315,
        short_circuit_rating_ka: 24.1,
        min_bending_radius_mm: 880,
        overall_diameter_mm: 69.5,
        weight_kg_per_km: 5280,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Industrial Plants", "Substations"],
      unit_price_inr_per_km: 785000,
      lead_time_days: 20
    },
    {
      sku_id: "HT-AL-XLPE-3C-240",
      product_name: "3 Core 240 sq.mm Aluminium XLPE 11kV HT Cable",
      category: "HT Power Cable",
      specifications: {
        voltage_rating: "11kV",
        voltage_rating_v: 11000,
        no_of_cores: 3,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 240,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 370,
        short_circuit_rating_ka: 31.2,
        min_bending_radius_mm: 960,
        overall_diameter_mm: 76.2,
        weight_kg_per_km: 6450,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Distribution", "Heavy Industrial", "Substations"],
      unit_price_inr_per_km: 985000,
      lead_time_days: 22
    },
    
    // =====================================================
    // LT (LOW TENSION) POWER CABLES - 1.1kV
    // =====================================================
    {
      sku_id: "LT-CU-XLPE-4C-25",
      product_name: "4 Core 25 sq.mm Copper XLPE 1.1kV LT Cable",
      category: "LT Power Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 4,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 25,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 95,
        short_circuit_rating_ka: 4.9,
        min_bending_radius_mm: 320,
        overall_diameter_mm: 32.5,
        weight_kg_per_km: 1850,
        standard_compliance: ["IS 7098 Part 1", "IEC 60502-1"]
      },
      applications: ["Building Wiring", "Industrial", "Commercial"],
      unit_price_inr_per_km: 125000,
      lead_time_days: 12
    },
    {
      sku_id: "LT-CU-XLPE-4C-35",
      product_name: "4 Core 35 sq.mm Copper XLPE 1.1kV LT Cable",
      category: "LT Power Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 4,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 35,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 115,
        short_circuit_rating_ka: 6.8,
        min_bending_radius_mm: 360,
        overall_diameter_mm: 36.2,
        weight_kg_per_km: 2350,
        standard_compliance: ["IS 7098 Part 1", "IEC 60502-1"]
      },
      applications: ["Building Wiring", "Industrial", "Commercial"],
      unit_price_inr_per_km: 165000,
      lead_time_days: 12
    },
    {
      sku_id: "LT-CU-XLPE-4C-50",
      product_name: "4 Core 50 sq.mm Copper XLPE 1.1kV LT Cable",
      category: "LT Power Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 4,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 50,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 140,
        short_circuit_rating_ka: 9.8,
        min_bending_radius_mm: 400,
        overall_diameter_mm: 40.5,
        weight_kg_per_km: 3050,
        standard_compliance: ["IS 7098 Part 1", "IEC 60502-1"]
      },
      applications: ["Building Wiring", "Industrial", "Commercial"],
      unit_price_inr_per_km: 215000,
      lead_time_days: 14
    },
    {
      sku_id: "LT-CU-XLPE-4C-70",
      product_name: "4 Core 70 sq.mm Copper XLPE 1.1kV LT Cable",
      category: "LT Power Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 4,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 70,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 170,
        short_circuit_rating_ka: 13.7,
        min_bending_radius_mm: 450,
        overall_diameter_mm: 45.8,
        weight_kg_per_km: 3950,
        standard_compliance: ["IS 7098 Part 1", "IEC 60502-1"]
      },
      applications: ["Industrial", "Infrastructure", "Commercial"],
      unit_price_inr_per_km: 295000,
      lead_time_days: 14
    },
    {
      sku_id: "LT-CU-XLPE-4C-95",
      product_name: "4 Core 95 sq.mm Copper XLPE 1.1kV LT Cable",
      category: "LT Power Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 4,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 95,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 205,
        short_circuit_rating_ka: 18.5,
        min_bending_radius_mm: 520,
        overall_diameter_mm: 52.5,
        weight_kg_per_km: 5150,
        standard_compliance: ["IS 7098 Part 1", "IEC 60502-1"]
      },
      applications: ["Industrial", "Infrastructure", "Heavy Commercial"],
      unit_price_inr_per_km: 395000,
      lead_time_days: 16
    },
    {
      sku_id: "LT-AL-XLPE-4C-95",
      product_name: "4 Core 95 sq.mm Aluminium XLPE 1.1kV LT Cable",
      category: "LT Power Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 4,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 95,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 175,
        short_circuit_rating_ka: 12.4,
        min_bending_radius_mm: 520,
        overall_diameter_mm: 52.8,
        weight_kg_per_km: 3250,
        standard_compliance: ["IS 7098 Part 1", "IEC 60502-1"]
      },
      applications: ["Industrial", "Infrastructure", "Outdoor"],
      unit_price_inr_per_km: 185000,
      lead_time_days: 14
    },
    {
      sku_id: "LT-AL-XLPE-4C-120",
      product_name: "4 Core 120 sq.mm Aluminium XLPE 1.1kV LT Cable",
      category: "LT Power Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 4,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 120,
        insulation_material: "XLPE",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 205,
        short_circuit_rating_ka: 15.6,
        min_bending_radius_mm: 580,
        overall_diameter_mm: 58.2,
        weight_kg_per_km: 3850,
        standard_compliance: ["IS 7098 Part 1", "IEC 60502-1"]
      },
      applications: ["Industrial", "Infrastructure", "Power Distribution"],
      unit_price_inr_per_km: 225000,
      lead_time_days: 14
    },
    
    // =====================================================
    // CONTROL CABLES
    // =====================================================
    {
      sku_id: "CTRL-CU-PVC-7C-2.5",
      product_name: "7 Core 2.5 sq.mm Copper PVC Control Cable",
      category: "Control Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 7,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 2.5,
        insulation_material: "PVC",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 70,
        current_carrying_capacity_a: 18,
        min_bending_radius_mm: 180,
        overall_diameter_mm: 18.5,
        weight_kg_per_km: 680,
        standard_compliance: ["IS 1554 Part 1", "IEC 60227"]
      },
      applications: ["Control Panels", "Automation", "Instrumentation"],
      unit_price_inr_per_km: 72000,
      lead_time_days: 10
    },
    {
      sku_id: "CTRL-CU-PVC-12C-1.5",
      product_name: "12 Core 1.5 sq.mm Copper PVC Control Cable",
      category: "Control Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 12,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 1.5,
        insulation_material: "PVC",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 70,
        current_carrying_capacity_a: 14,
        min_bending_radius_mm: 200,
        overall_diameter_mm: 20.2,
        weight_kg_per_km: 820,
        standard_compliance: ["IS 1554 Part 1", "IEC 60227"]
      },
      applications: ["Control Panels", "PLC Systems", "Automation"],
      unit_price_inr_per_km: 78000,
      lead_time_days: 10
    },
    {
      sku_id: "CTRL-CU-PVC-19C-2.5",
      product_name: "19 Core 2.5 sq.mm Copper PVC Control Cable",
      category: "Control Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 19,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 2.5,
        insulation_material: "PVC",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 70,
        current_carrying_capacity_a: 18,
        min_bending_radius_mm: 280,
        overall_diameter_mm: 28.5,
        weight_kg_per_km: 1450,
        standard_compliance: ["IS 1554 Part 1", "IEC 60227"]
      },
      applications: ["Control Panels", "Heavy Automation", "Industrial"],
      unit_price_inr_per_km: 125000,
      lead_time_days: 12
    },
    {
      sku_id: "CTRL-CU-PVC-24C-1.5",
      product_name: "24 Core 1.5 sq.mm Copper PVC Control Cable",
      category: "Control Cable",
      specifications: {
        voltage_rating: "1.1kV",
        voltage_rating_v: 1100,
        no_of_cores: 24,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 1.5,
        insulation_material: "PVC",
        inner_sheath: "PVC",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 70,
        current_carrying_capacity_a: 14,
        min_bending_radius_mm: 300,
        overall_diameter_mm: 30.5,
        weight_kg_per_km: 1650,
        standard_compliance: ["IS 1554 Part 1", "IEC 60227"]
      },
      applications: ["Large Control Systems", "DCS", "Industrial Automation"],
      unit_price_inr_per_km: 155000,
      lead_time_days: 14
    },
    
    // =====================================================
    // INSTRUMENTATION CABLES
    // =====================================================
    {
      sku_id: "INST-CU-PVC-2P-1.5",
      product_name: "2 Pair 1.5 sq.mm Copper PVC Instrumentation Cable",
      category: "Instrumentation Cable",
      specifications: {
        voltage_rating: "600V",
        voltage_rating_v: 600,
        no_of_pairs: 2,
        no_of_cores: 4,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 1.5,
        insulation_material: "PVC",
        shield_type: "Aluminium Mylar with Drain Wire",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 70,
        impedance_ohm: 100,
        capacitance_pf_per_m: 52,
        overall_diameter_mm: 14.2,
        weight_kg_per_km: 320,
        standard_compliance: ["IS 1554 Part 1", "IEC 60227"]
      },
      applications: ["Process Control", "DCS Systems", "PLC I/O"],
      unit_price_inr_per_km: 32000,
      lead_time_days: 8
    },
    {
      sku_id: "INST-CU-PVC-4P-1.5",
      product_name: "4 Pair 1.5 sq.mm Copper PVC Instrumentation Cable",
      category: "Instrumentation Cable",
      specifications: {
        voltage_rating: "600V",
        voltage_rating_v: 600,
        no_of_pairs: 4,
        no_of_cores: 8,
        conductor_material: "Copper",
        conductor_cross_section_mm2: 1.5,
        insulation_material: "PVC",
        shield_type: "Aluminium Mylar with Drain Wire",
        armour_type: "Steel Wire Armoured (SWA)",
        outer_sheath: "PVC",
        temperature_rating_c: 70,
        impedance_ohm: 100,
        capacitance_pf_per_m: 52,
        overall_diameter_mm: 18.5,
        weight_kg_per_km: 520,
        standard_compliance: ["IS 1554 Part 1", "IEC 60227"]
      },
      applications: ["Process Control", "Field Instruments", "Transmitters"],
      unit_price_inr_per_km: 48000,
      lead_time_days: 10
    },
    
    // =====================================================
    // EHT (EXTRA HIGH TENSION) CABLES - 33kV
    // =====================================================
    {
      sku_id: "EHT-AL-XLPE-1C-300-33KV",
      product_name: "1 Core 300 sq.mm Aluminium XLPE 33kV Cable",
      category: "EHT Power Cable",
      specifications: {
        voltage_rating: "33kV",
        voltage_rating_v: 33000,
        no_of_cores: 1,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 300,
        insulation_material: "XLPE",
        inner_sheath: "Semiconducting Layer",
        armour_type: "Aluminium Wire Armoured (AWA)",
        outer_sheath: "HDPE",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 545,
        short_circuit_rating_ka: 39.0,
        min_bending_radius_mm: 1200,
        overall_diameter_mm: 72.5,
        weight_kg_per_km: 4850,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Transmission", "Grid Interconnection", "Substations"],
      unit_price_inr_per_km: 1450000,
      lead_time_days: 30
    },
    {
      sku_id: "EHT-AL-XLPE-1C-400-33KV",
      product_name: "1 Core 400 sq.mm Aluminium XLPE 33kV Cable",
      category: "EHT Power Cable",
      specifications: {
        voltage_rating: "33kV",
        voltage_rating_v: 33000,
        no_of_cores: 1,
        conductor_material: "Aluminium",
        conductor_cross_section_mm2: 400,
        insulation_material: "XLPE",
        inner_sheath: "Semiconducting Layer",
        armour_type: "Aluminium Wire Armoured (AWA)",
        outer_sheath: "HDPE",
        temperature_rating_c: 90,
        current_carrying_capacity_a: 630,
        short_circuit_rating_ka: 52.0,
        min_bending_radius_mm: 1350,
        overall_diameter_mm: 78.2,
        weight_kg_per_km: 5650,
        standard_compliance: ["IS 7098 Part 2", "IEC 60502-2"]
      },
      applications: ["Power Transmission", "Grid Interconnection", "Substations"],
      unit_price_inr_per_km: 1850000,
      lead_time_days: 35
    }
  ]
};

/**
 * Test & Acceptance Services Pricing Table
 * Synthetic pricing data for tests required in RFPs
 */
export const SERVICES_PRICING_TABLE = {
  metadata: {
    description: "Test and acceptance services pricing for cable products",
    currency: "INR",
    validity: "2025-2026"
  },
  
  tests: [
    // Routine Tests (performed on every drum)
    {
      test_id: "RT-001",
      test_name: "Conductor Resistance Test",
      test_category: "Routine Test",
      description: "DC resistance measurement of conductor at 20°C",
      standard: "IS 8130 / IEC 60228",
      price_inr: 2500,
      duration_hours: 2,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "RT-002",
      test_name: "High Voltage Test (HV Test)",
      test_category: "Routine Test",
      description: "AC voltage withstand test on insulation",
      standard: "IS 7098 / IEC 60502",
      price_inr: 4500,
      duration_hours: 1,
      applicable_products: ["HT Cable", "LT Cable", "Control Cable"]
    },
    {
      test_id: "RT-003",
      test_name: "Insulation Resistance Test",
      test_category: "Routine Test",
      description: "Measurement of insulation resistance using megger",
      standard: "IS 10810 / IEC 60502",
      price_inr: 1800,
      duration_hours: 1,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "RT-004",
      test_name: "Spark Test",
      test_category: "Routine Test",
      description: "100% production test for insulation defects",
      standard: "IS 7098",
      price_inr: 1500,
      duration_hours: 0.5,
      applicable_products: ["All Cables"]
    },
    
    // Type Tests (performed once for type approval)
    {
      test_id: "TT-001",
      test_name: "Partial Discharge Test",
      test_category: "Type Test",
      description: "Measurement of partial discharge inception voltage",
      standard: "IS 7098 / IEC 60885",
      price_inr: 35000,
      duration_hours: 8,
      applicable_products: ["HT Cable", "EHT Cable"]
    },
    {
      test_id: "TT-002",
      test_name: "Impulse Withstand Test",
      test_category: "Type Test",
      description: "Lightning impulse voltage withstand test",
      standard: "IS 7098 / IEC 60230",
      price_inr: 45000,
      duration_hours: 4,
      applicable_products: ["HT Cable", "EHT Cable"]
    },
    {
      test_id: "TT-003",
      test_name: "Bending Test",
      test_category: "Type Test",
      description: "Flexibility test at minimum bending radius",
      standard: "IS 7098 / IEC 60502",
      price_inr: 12000,
      duration_hours: 4,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "TT-004",
      test_name: "Tensile Strength Test",
      test_category: "Type Test",
      description: "Mechanical strength testing of insulation",
      standard: "IS 5831 / IEC 60811",
      price_inr: 8500,
      duration_hours: 3,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "TT-005",
      test_name: "Elongation Test",
      test_category: "Type Test",
      description: "Elongation at break measurement",
      standard: "IS 5831 / IEC 60811",
      price_inr: 8500,
      duration_hours: 3,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "TT-006",
      test_name: "Hot Set Test",
      test_category: "Type Test",
      description: "Cross-linking degree verification for XLPE",
      standard: "IEC 60811-507",
      price_inr: 15000,
      duration_hours: 6,
      applicable_products: ["XLPE Cables"]
    },
    {
      test_id: "TT-007",
      test_name: "Thermal Stability Test",
      test_category: "Type Test",
      description: "Aging characteristics under thermal stress",
      standard: "IEC 60811",
      price_inr: 25000,
      duration_hours: 168,
      applicable_products: ["HT Cable", "EHT Cable"]
    },
    {
      test_id: "TT-008",
      test_name: "Water Immersion Test",
      test_category: "Type Test",
      description: "Water absorption test after immersion",
      standard: "IEC 60502",
      price_inr: 18000,
      duration_hours: 48,
      applicable_products: ["HT Cable", "LT Cable"]
    },
    
    // Acceptance Tests (at site)
    {
      test_id: "AT-001",
      test_name: "Drum Test (Site)",
      test_category: "Acceptance Test",
      description: "Visual and dimensional inspection at site",
      standard: "Project Specification",
      price_inr: 3500,
      duration_hours: 2,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "AT-002",
      test_name: "Continuity Test (Site)",
      test_category: "Acceptance Test",
      description: "Conductor continuity verification after laying",
      standard: "Project Specification",
      price_inr: 2000,
      duration_hours: 1,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "AT-003",
      test_name: "IR Test After Laying",
      test_category: "Acceptance Test",
      description: "Insulation resistance test after installation",
      standard: "IS 10810",
      price_inr: 4000,
      duration_hours: 2,
      applicable_products: ["All Cables"]
    },
    {
      test_id: "AT-004",
      test_name: "HV Test After Laying",
      test_category: "Acceptance Test",
      description: "High voltage test on completed installation",
      standard: "IS 7098 / IEC 60502",
      price_inr: 12000,
      duration_hours: 4,
      applicable_products: ["HT Cable", "EHT Cable"]
    },
    {
      test_id: "AT-005",
      test_name: "Sheath Integrity Test",
      test_category: "Acceptance Test",
      description: "Outer sheath integrity verification",
      standard: "IEC 60229",
      price_inr: 6500,
      duration_hours: 2,
      applicable_products: ["HT Cable", "EHT Cable"]
    },
    
    // Special Tests
    {
      test_id: "SP-001",
      test_name: "Flame Retardant Test",
      test_category: "Special Test",
      description: "Fire resistance category C test",
      standard: "IEC 60332-3",
      price_inr: 28000,
      duration_hours: 8,
      applicable_products: ["FR Cables", "Fire Survival Cables"]
    },
    {
      test_id: "SP-002",
      test_name: "Smoke Density Test",
      test_category: "Special Test",
      description: "Smoke emission measurement during combustion",
      standard: "IEC 61034",
      price_inr: 22000,
      duration_hours: 6,
      applicable_products: ["LSZH Cables", "FR Cables"]
    },
    {
      test_id: "SP-003",
      test_name: "Halogen Content Test",
      test_category: "Special Test",
      description: "Halogen acid gas emission test",
      standard: "IEC 60754",
      price_inr: 18000,
      duration_hours: 4,
      applicable_products: ["LSZH Cables"]
    },
    {
      test_id: "SP-004",
      test_name: "Tan Delta Test",
      test_category: "Special Test",
      description: "Dielectric loss factor measurement",
      standard: "IEC 60885-2",
      price_inr: 32000,
      duration_hours: 6,
      applicable_products: ["HT Cable", "EHT Cable"]
    }
  ]
};

/**
 * Get all OEM products
 */
export function getOEMProducts() {
  return OEM_PRODUCT_CATALOG.products;
}

/**
 * Get product by SKU ID
 */
export function getProductBySKU(skuId) {
  return OEM_PRODUCT_CATALOG.products.find(p => p.sku_id === skuId);
}

/**
 * Get all tests
 */
export function getAllTests() {
  return SERVICES_PRICING_TABLE.tests;
}

/**
 * Get test by ID
 */
export function getTestById(testId) {
  return SERVICES_PRICING_TABLE.tests.find(t => t.test_id === testId);
}

/**
 * Get tests by category
 */
export function getTestsByCategory(category) {
  return SERVICES_PRICING_TABLE.tests.filter(t => t.test_category === category);
}

/**
 * Get applicable tests for a product category
 */
export function getApplicableTests(productCategory) {
  return SERVICES_PRICING_TABLE.tests.filter(t => 
    t.applicable_products.includes(productCategory) || 
    t.applicable_products.includes("All Cables")
  );
}

export default {
  OEM_PRODUCT_CATALOG,
  SERVICES_PRICING_TABLE,
  getOEMProducts,
  getProductBySKU,
  getAllTests,
  getTestById,
  getTestsByCategory,
  getApplicableTests
};











