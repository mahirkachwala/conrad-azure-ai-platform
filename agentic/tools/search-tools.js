/**
 * Search Tools for Agentic System
 * EY Techathon 6.0 - AI RFP Automation System
 * 
 * LangChain tool definitions for portal searching and RFP discovery.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Portal data paths
const PORTAL_PATHS = {
  gov: path.join(__dirname, '../../public/data/portals/gov.json'),
  industrial: path.join(__dirname, '../../public/data/portals/industrial.json'),
  utilities: path.join(__dirname, '../../public/data/portals/utilities.json')
};

/**
 * Tool: Search Portals for RFPs
 * Scans specified portals and returns RFPs matching criteria
 */
export const searchPortalsTool = tool(
  async ({ portals, deadline_days, min_budget, max_budget, keywords }) => {
    const results = [];
    const now = new Date();
    const deadlineCutoff = new Date(now.getTime() + (deadline_days || 90) * 24 * 60 * 60 * 1000);
    
    // Determine which portals to search
    const portalsToSearch = portals && portals.length > 0 
      ? portals 
      : ['gov', 'industrial', 'utilities'];
    
    for (const portalKey of portalsToSearch) {
      const filePath = PORTAL_PATHS[portalKey];
      if (!filePath || !fs.existsSync(filePath)) continue;
      
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        for (const tender of data) {
          // Filter by deadline
          const dueDate = new Date(tender.due_date);
          if (dueDate < now || dueDate > deadlineCutoff) continue;
          
          // Filter by budget
          const budget = tender.estimated_cost_inr || 0;
          if (min_budget && budget < min_budget) continue;
          if (max_budget && budget > max_budget) continue;
          
          // Filter by keywords (if provided)
          if (keywords && keywords.length > 0) {
            const searchText = `${tender.title} ${tender.material} ${tender.organisation}`.toLowerCase();
            const hasKeyword = keywords.some(kw => searchText.includes(kw.toLowerCase()));
            if (!hasKeyword) continue;
          }
          
          // Calculate days until deadline
          const daysUntilDeadline = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
          
          results.push({
            tender_id: tender.tender_id,
            title: tender.title,
            organisation: tender.organisation,
            city: tender.city,
            estimated_cost_inr: budget,
            due_date: tender.due_date,
            days_until_deadline: daysUntilDeadline,
            portal: portalKey,
            pdf_url: tender.pdf_url || `/rfps/${tender.tender_id}.pdf`,
            cable_requirements: tender.cable_requirements || [],
            submission: tender.submission
          });
        }
      } catch (error) {
        console.error(`Error reading portal ${portalKey}:`, error.message);
      }
    }
    
    // Sort by deadline (nearest first)
    results.sort((a, b) => a.days_until_deadline - b.days_until_deadline);
    
    return JSON.stringify({
      total_found: results.length,
      portals_searched: portalsToSearch,
      deadline_window_days: deadline_days || 90,
      rfps: results.slice(0, 20) // Return top 20
    });
  },
  {
    name: "search_portals",
    description: "Search RFP portals (government, industrial, utilities) for tenders. Returns RFPs matching criteria sorted by deadline.",
    schema: z.object({
      portals: z.array(z.enum(['gov', 'industrial', 'utilities'])).optional()
        .describe("Which portals to search. Leave empty to search all."),
      deadline_days: z.number().optional()
        .describe("Only return RFPs due within this many days. Default 90."),
      min_budget: z.number().optional()
        .describe("Minimum budget in INR"),
      max_budget: z.number().optional()
        .describe("Maximum budget in INR"),
      keywords: z.array(z.string()).optional()
        .describe("Keywords to filter by (e.g., ['cable', 'HT', 'copper'])")
    })
  }
);

/**
 * Tool: Get RFP Details
 * Retrieves full details of a specific RFP by ID
 */
export const getRFPDetailsTool = tool(
  async ({ tender_id }) => {
    // Search all portals for this tender
    for (const [portalKey, filePath] of Object.entries(PORTAL_PATHS)) {
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const tender = data.find(t => t.tender_id === tender_id);
        
        if (tender) {
          return JSON.stringify({
            found: true,
            portal: portalKey,
            tender: tender
          });
        }
      } catch (error) {
        continue;
      }
    }
    
    return JSON.stringify({
      found: false,
      error: `Tender ${tender_id} not found in any portal`
    });
  },
  {
    name: "get_rfp_details",
    description: "Get full details of a specific RFP by its tender ID",
    schema: z.object({
      tender_id: z.string().describe("The tender ID (e.g., 'GOV-101', 'IND-205')")
    })
  }
);

/**
 * Tool: Calculate RFP Score
 * Calculates qualification score for an RFP opportunity
 */
export const calculateRFPScoreTool = tool(
  async ({ tender_id, days_until_deadline, estimated_budget, requirements_count, has_clear_submission }) => {
    let score = 0;
    const breakdown = [];
    
    // Time factor (max 30 points)
    if (days_until_deadline >= 30 && days_until_deadline <= 60) {
      score += 30;
      breakdown.push("Time: +30 (ideal window 30-60 days)");
    } else if (days_until_deadline > 60) {
      score += 25;
      breakdown.push("Time: +25 (more than 60 days)");
    } else if (days_until_deadline >= 14) {
      score += 15;
      breakdown.push("Time: +15 (14-30 days)");
    } else {
      score += 5;
      breakdown.push("Time: +5 (less than 14 days - urgent)");
    }
    
    // Budget factor (max 25 points)
    if (estimated_budget >= 50000000) {
      score += 25;
      breakdown.push("Budget: +25 (5+ crore)");
    } else if (estimated_budget >= 10000000) {
      score += 20;
      breakdown.push("Budget: +20 (1-5 crore)");
    } else if (estimated_budget >= 5000000) {
      score += 15;
      breakdown.push("Budget: +15 (50L-1Cr)");
    } else if (estimated_budget >= 1000000) {
      score += 10;
      breakdown.push("Budget: +10 (10-50L)");
    } else {
      score += 5;
      breakdown.push("Budget: +5 (less than 10L)");
    }
    
    // Requirements clarity (max 25 points)
    if (requirements_count >= 3) {
      score += 25;
      breakdown.push("Requirements: +25 (3+ clear items)");
    } else if (requirements_count >= 1) {
      score += 15;
      breakdown.push("Requirements: +15 (1-2 items)");
    } else {
      score += 5;
      breakdown.push("Requirements: +5 (unclear)");
    }
    
    // Submission mode (max 20 points)
    if (has_clear_submission) {
      score += 20;
      breakdown.push("Submission: +20 (clear instructions)");
    } else {
      score += 5;
      breakdown.push("Submission: +5 (unclear)");
    }
    
    return JSON.stringify({
      tender_id,
      score: Math.min(100, score),
      max_score: 100,
      breakdown,
      recommendation: score >= 70 ? "HIGH_PRIORITY" : score >= 50 ? "MEDIUM_PRIORITY" : "LOW_PRIORITY"
    });
  },
  {
    name: "calculate_rfp_score",
    description: "Calculate a qualification score (0-100) for an RFP opportunity to help prioritize which RFPs to bid on",
    schema: z.object({
      tender_id: z.string().describe("Tender ID for reference"),
      days_until_deadline: z.number().describe("Days until submission deadline"),
      estimated_budget: z.number().describe("Estimated budget in INR"),
      requirements_count: z.number().describe("Number of clear product requirements"),
      has_clear_submission: z.boolean().describe("Whether submission instructions are clear")
    })
  }
);

/**
 * Tool: Get Portal Statistics
 * Returns statistics about available RFPs across portals
 */
export const getPortalStatsTool = tool(
  async () => {
    const stats = {
      portals: {},
      total_rfps: 0,
      total_value: 0,
      by_deadline: {
        urgent: 0,      // < 14 days
        soon: 0,        // 14-30 days
        normal: 0,      // 30-60 days
        far: 0          // > 60 days
      }
    };
    
    const now = new Date();
    
    for (const [portalKey, filePath] of Object.entries(PORTAL_PATHS)) {
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const activeTenders = data.filter(t => new Date(t.due_date) > now);
        
        stats.portals[portalKey] = {
          total: activeTenders.length,
          total_value: activeTenders.reduce((sum, t) => sum + (t.estimated_cost_inr || 0), 0)
        };
        
        stats.total_rfps += activeTenders.length;
        stats.total_value += stats.portals[portalKey].total_value;
        
        // Categorize by deadline
        for (const tender of activeTenders) {
          const daysLeft = Math.ceil((new Date(tender.due_date) - now) / (1000 * 60 * 60 * 24));
          if (daysLeft < 14) stats.by_deadline.urgent++;
          else if (daysLeft < 30) stats.by_deadline.soon++;
          else if (daysLeft < 60) stats.by_deadline.normal++;
          else stats.by_deadline.far++;
        }
      } catch (error) {
        stats.portals[portalKey] = { error: error.message };
      }
    }
    
    return JSON.stringify(stats);
  },
  {
    name: "get_portal_stats",
    description: "Get statistics about available RFPs across all portals including counts and total values",
    schema: z.object({})
  }
);

export const searchTools = [
  searchPortalsTool,
  getRFPDetailsTool,
  calculateRFPScoreTool,
  getPortalStatsTool
];

export default searchTools;



