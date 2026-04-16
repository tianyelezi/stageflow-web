// === Enums ===

export type EventType = 'annual_meeting' | 'product_launch' | 'award_ceremony' | 'gala' | 'custom';
export type BudgetLevel = 'low' | 'medium' | 'high' | 'premium';
export type ProjectStatus =
  | 'draft'
  | 'researching'
  | 'research_review'
  | 'visual_suggestions'
  | 'direction_selection'
  | 'alignment'
  | 'generating_layouts'
  | 'proposal_ready'
  | 'completed'
  | 'failed';
export type UserRole = 'admin' | 'event_company' | 'designer';
export type ZoneType =
  | 'main_stage'
  | 'photo_wall'
  | 'entrance'
  | 'check_in_desk'
  | 'history_wall'
  | 'honor_wall'
  | 'interactive_zone';
export type ProposalStatus = 'generating' | 'ready' | 'stale' | 'delivered';
export type AlignmentStatus = 'pending' | 'completed';

// === Shared ===

export interface Dimensions {
  width: number;
  depth: number;
  height: number;
}

export interface VenueInfo {
  name: string;
  dimensions: Dimensions;
  capacity: number;
}

// === Project ===

export interface Project {
  id: string;
  userId: string;
  designerId?: string;
  companyName: string;
  eventType: EventType;
  eventName: string;
  industry?: string;
  eventDate?: string;
  venueInfo?: VenueInfo;
  budget?: BudgetLevel;
  additionalRequirements?: string;
  referenceImages?: string[];
  templateId?: string;
  status: ProjectStatus;
  workflowRunId?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

// === Brand Research ===

export interface BrandResearchResult {
  projectId: string;
  companyHistory: string;
  brandKeywords: string[];
  industryTrends: string[];
  stageConventions: string[];
  competitors: Array<{ name: string; notes: string }>;
  brandColors: string[];
  brandValues: string[];
  researchProvider: 'openai' | 'gemini';
  userCorrections: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

// === Visual Elements ===

export interface ColorEntry {
  hex: string;
  name: string;
  usage: 'primary' | 'secondary' | 'accent' | 'background' | 'text';
}

export interface VisualMotif {
  name: string;
  description: string;
}

export interface SpatialPreferences {
  structure: 'symmetric' | 'asymmetric' | 'modular' | 'organic';
  scale: 'intimate' | 'medium' | 'grand';
  materials: string[];
}

export interface LightingStyle {
  mood: string;
  techniques: string[];
  colorTemperature: 'cool' | 'warm' | 'mixed';
}

export interface VisualElements {
  projectId: string;
  colorPalette: ColorEntry[];
  visualMotifs: VisualMotif[];
  spatialPreferences: SpatialPreferences;
  lightingStyle: LightingStyle;
  typographyDirection: string;
  createdAt: string;
}

// === Creative Direction ===

export interface CreativeDirection {
  id: string;
  name: string;
  styleDescription: string;
  mainKvConcept: string;
  stageStructure: string;
  lightingSuggestions: string;
  visualSuggestions: string;
  moodBoardKeywords: string[];
}

export interface CreativeDirections {
  projectId: string;
  directions: CreativeDirection[];
  selectedDirectionId: string | null;
  createdAt: string;
}

// === Designer Alignment ===

export interface AlignmentQuestion {
  id: string;
  question: string;
  category: string;
  answer: string | null;
}

export interface DesignerAlignment {
  projectId: string;
  questions: AlignmentQuestion[];
  alignmentStatus: AlignmentStatus;
  refinedBrief: string | null;
  answeredAt: string | null;
  createdAt: string;
}

// === Spatial Layout ===

export interface MaterialItem {
  name: string;
  spec: string;
  quantity: string;
  unitPriceRange: string;
}

export interface CostEstimate {
  materialCostMin: number;
  materialCostMax: number;
  laborCostMin: number;
  laborCostMax: number;
  totalMin: number;
  totalMax: number;
  notes?: string;
}

export interface SpatialZone {
  type: ZoneType;
  name: string;
  description: string;
  designConcept: string;
  dimensions: Dimensions;
  imageUrl: string | null;
  imagePrompt: string;
  materials: string[];
  materialList?: MaterialItem[];
  costEstimate?: CostEstimate;
  constructionDays?: number;
  lightingNotes: string;
  technicalRequirements: string | null;
}

export interface SpatialLayouts {
  projectId: string;
  zones: SpatialZone[];
  overallLayout: string;
  floorPlanDescription: string;
  createdAt: string;
}

// === Proposal ===

export interface ProposalSection {
  order: number;
  title: string;
  content: string;
  images: string[];
}

export interface Proposal {
  projectId: string;
  title: string;
  sections: ProposalSection[];
  designRationale: string;
  documentUrls: {
    pdf: string | null;
    pptx: string | null;
    imagesPack: string | null;
  };
  status: ProposalStatus;
  createdAt: string;
}

// === User ===

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organization: string;
  createdAt: string;
}

// === Template ===

export interface Template {
  id: string;
  name: string;
  description: string;
  eventType: EventType;
  defaultColorPalette: Array<{ hex: string; name: string }>;
  defaultZones: ZoneType[];
  stylePresets: {
    lighting: string;
    structure: string;
    mood: string;
  };
  createdBy: string;
  isPublic: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

// === API Response ===

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
