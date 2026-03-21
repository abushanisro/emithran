"""
AI-Enhanced DFM Analysis System
Integrates Claude AI for advanced Design for Manufacturing insights

Author: mithran Platform
Standards: ISO 2768, ASME Y14.5, DFM Best Practices
"""

import os
import logging
import json
import time
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict

# Load .env file if present (needed inside Docker where env vars may not be set)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # python-dotenv not installed — read .env manually
    _env_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith('#') and '=' in _line:
                    _k, _v = _line.split('=', 1)
                    os.environ.setdefault(_k.strip(), _v.strip())

import anthropic
from datetime import datetime

logger = logging.getLogger(__name__)

@dataclass
class AIDFMInsights:
    """AI-generated DFM insights"""
    manufacturing_complexity: float  # 0-100 scale
    process_recommendations: List[Dict[str, Any]]
    cost_optimization_suggestions: List[str]
    quality_considerations: List[str]
    material_recommendations: List[Dict[str, Any]]
    tooling_requirements: Dict[str, Any]
    lead_time_estimate_days: float
    risk_assessment: Dict[str, Any]
    ai_confidence: float
    generation_time_ms: float
    dfm_warnings: Optional[List[Dict[str, Any]]] = None  # AI-sourced DFM-specific warnings

    def __post_init__(self):
        if self.dfm_warnings is None:
            self.dfm_warnings = []

@dataclass  
class EnhancedDFMResult:
    """Enhanced DFM analysis combining traditional + AI insights"""
    # Traditional DFM metrics
    manufacturability_score: float
    difficulty_level: str
    recommended_processes: List[str]
    warnings: List[Dict[str, Any]]
    cost_impact_factors: List[Dict[str, Any]]
    confidence: float
    
    # AI-enhanced insights
    ai_insights: Optional[AIDFMInsights]
    detailed_recommendations: List[Dict[str, Any]]
    competitive_analysis: Dict[str, Any]
    sustainability_metrics: Dict[str, Any]

class AIEnhancedDFMAnalyzer:
    """
    AI-Enhanced Design for Manufacturing Analyzer
    
    Combines traditional geometric analysis with Claude AI
    for enterprise-grade manufacturability insights
    """
    
    def __init__(self, api_key: Optional[str] = None, model_name: str = "claude-3-5-sonnet-20241022"):
        """
        Initialize AI DFM Analyzer

        Args:
            api_key: Claude API key (optional, uses env var if not provided)
            model_name: Claude model to use
        """
        self.api_key = api_key or os.getenv('ANTHROPIC_API_KEY')
        self.model_name = model_name

        # Configure Claude AI if API key is available
        self.ai_enabled = False
        if self.api_key:
            try:
                self.client = anthropic.Anthropic(api_key=self.api_key)
                self.ai_enabled = True
                logger.info(f"AI DFM Analysis enabled with {model_name}")
            except Exception as e:
                logger.warning(f"Failed to initialize Claude AI: {e}")
                self.ai_enabled = False
        else:
            logger.info("No Claude API key provided, running without AI enhancement")

    def analyze_with_ai_enhancement(
        self,
        geometry_features: Dict[str, Any],
        traditional_dfm: Dict[str, Any],
        file_name: str = "unknown",
        user_processes: Optional[List[Dict[str, Any]]] = None
    ) -> EnhancedDFMResult:
        """
        Perform enhanced DFM analysis combining traditional + AI insights.

        Args:
            geometry_features:  Geometric analysis results (real measurements)
            traditional_dfm:    Traditional DFM analysis results
            file_name:          Original filename for context
            user_processes:     Optional list of processes from the user's process API
                                Each process: {processName, processCategory, machineType,
                                cycleTimeMinutes, setupTimeMinutes, skillLevelRequired, ...}

        Returns:
            Enhanced DFM result with AI insights
        """
        start_time = time.time()

        enhanced_result = EnhancedDFMResult(
            manufacturability_score=traditional_dfm.get('manufacturability_score', 0.5),
            difficulty_level=traditional_dfm.get('difficulty_level', 'medium'),
            recommended_processes=traditional_dfm.get('recommended_processes', []),
            warnings=traditional_dfm.get('warnings', []),
            cost_impact_factors=traditional_dfm.get('cost_impact_factors', []),
            confidence=traditional_dfm.get('confidence', 0.7),
            ai_insights=None,
            detailed_recommendations=[],
            competitive_analysis={},
            sustainability_metrics={}
        )

        if self.ai_enabled:
            try:
                ai_insights = self._generate_ai_insights(
                    geometry_features, traditional_dfm, file_name, user_processes or []
                )
                enhanced_result.ai_insights = ai_insights
                enhanced_result = self._merge_ai_with_traditional(enhanced_result, ai_insights)
                logger.info(f"AI-enhanced DFM analysis completed in {(time.time() - start_time)*1000:.1f}ms")
            except Exception as e:
                logger.error(f"AI enhancement failed: {e}")
                enhanced_result.ai_insights = self._create_fallback_insights()
        else:
            enhanced_result.ai_insights = self._create_fallback_insights()
            enhanced_result = self._enhance_traditional_analysis(enhanced_result)

        return enhanced_result

    def _generate_ai_insights(
        self,
        geometry_features: Dict[str, Any],
        traditional_dfm: Dict[str, Any],
        file_name: str,
        user_processes: List[Dict[str, Any]]
    ) -> AIDFMInsights:
        """Generate AI-powered DFM insights using Claude — real geometry, real processes."""

        start_time = time.time()
        prompt = self._create_dfm_analysis_prompt(geometry_features, traditional_dfm, file_name, user_processes)

        try:
            response = self.client.messages.create(
                model=self.model_name,
                max_tokens=4096,
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
            ai_response = response.content[0].text
            insights = self._parse_ai_response(ai_response)
            processing_time = (time.time() - start_time) * 1000
            insights.generation_time_ms = processing_time
            return insights
        except Exception as e:
            logger.error(f"AI generation failed: {e}")
            raise

    def _create_dfm_analysis_prompt(
        self,
        geometry_features: Dict[str, Any],
        traditional_dfm: Dict[str, Any],
        file_name: str,
        user_processes: List[Dict[str, Any]]
    ) -> str:
        """Create a comprehensive, grounded DFM analysis prompt with real measurements."""

        bbox = geometry_features.get('bounding_box', {})
        mfg = geometry_features.get('manufacturing_features', {})
        holes = mfg.get('holes', {})
        pockets = mfg.get('pockets', {})
        fc = geometry_features.get('feature_count', {})

        # Format user processes list
        if user_processes:
            proc_lines = []
            for p in user_processes[:20]:  # type: ignore
                name = p.get('processName') or p.get('process_name', 'Unknown')
                cat  = p.get('processCategory') or p.get('process_category', '')
                mach = p.get('machineType') or p.get('machine_type', '')
                ct   = p.get('cycleTimeMinutes') or p.get('cycle_time_minutes', '')
                st   = p.get('setupTimeMinutes') or p.get('setup_time_minutes', '')
                proc_lines.append(f"  • {name} | Category: {cat} | Machine: {mach} | Cycle: {ct}min | Setup: {st}min")
            processes_section = "AVAILABLE MANUFACTURING PROCESSES (from company database):\n" + "\n".join(proc_lines)
            process_names = [p.get('processName') or p.get('process_name', '') for p in user_processes[:20]]  # type: ignore
        else:
            processes_section = "AVAILABLE MANUFACTURING PROCESSES: Standard industry processes (CNC Machining, Casting, Sheet Metal, Additive Manufacturing, Forging, Injection Molding)"
            process_names = ["CNC Machining", "Investment Casting", "Sheet Metal Forming", "Additive Manufacturing", "Forging", "Injection Molding"]

        hole_info = f"{holes.get('count',0)} holes detected, diameters: {holes.get('diameters','N/A')}" if holes.get('count') else "No holes detected"
        pocket_info = f"{pockets.get('count',0)} pockets, depth {pockets.get('min_depth','N/A')}–{pockets.get('max_depth','N/A')}mm" if pockets.get('count') else "No pockets detected"
        
        wall_mm = mfg.get('thin_walls', 'N/A')
        undercuts = mfg.get('undercuts', {})
        undercut_info = f"Yes — {undercuts.get('count',0)} face(s)" if undercuts.get('detected') else "None detected"

        return f"""You are a Principal Manufacturing Engineer performing a Design for Manufacturing (DFM) analysis.
You must reason from the ACTUAL measurements given — do not fabricate or assume values.

===== PART GEOMETRY (extracted from CAD file: {file_name}) =====
Volume:             {geometry_features.get('volume_mm3', geometry_features.get('volume', 'N/A'))} mm³
Surface Area:       {geometry_features.get('surface_area_mm2', geometry_features.get('surface_area', 'N/A'))} mm²
Bounding Box:       L={bbox.get('length','N/A')}mm × W={bbox.get('width','N/A')}mm × H={bbox.get('height','N/A')}mm
Complexity Score:   {geometry_features.get('complexity_score', 'N/A')} / 10
Topological Count:  {fc.get('faces','N/A')} faces, {fc.get('edges','N/A')} edges, {fc.get('vertices','N/A')} vertices
Holes:              {hole_info}
Pockets:            {pocket_info}
Min Wall Thickness: {wall_mm} mm  (ISO 2768 minimum for CNC: 0.8mm)
Undercuts:          {undercut_info}

===== INITIAL DFM SCORING =====
Manufacturability:  {traditional_dfm.get('manufacturability_score', 'N/A')} (0=worst, 1=best)
Difficulty Level:   {traditional_dfm.get('difficulty_level', 'N/A')}
Geometric Warnings: {len(traditional_dfm.get('warnings', []))} detected

{processes_section}

===== INSTRUCTIONS =====
Analyze the part and respond ONLY with a single valid JSON object (no markdown, no preamble).

Required JSON structure:
{{
  "manufacturing_complexity": <float 0–100, based on actual geometry>,
  "process_recommendations": [
    {{
      "name": "<exact process name from available list>",
      "suitability_score": <float 0–1>,
      "cost_factor": <relative cost multiplier, 1.0 = baseline>,
      "lead_time": <integer days>,
      "pros": ["<specific to THIS part geometry>"],
      "cons": ["<specific to THIS part geometry>"],
      "reasoning": "<cite actual measurements: wall thickness, volume, hole count, etc.>"
    }}
  ],
  "cost_optimization_suggestions": ["<actionable, specific to geometry>"],
  "quality_considerations": ["<inspection points based on actual features>"],
  "material_recommendations": [
    {{
      "name": "<material>",
      "grade": "<specific grade e.g. Al 6061-T6>",
      "machinability_rating": "<Excellent/Good/Fair/Poor>",
      "cost_factor": <float>,
      "reason": "<why suited for this volume/complexity>"
    }}
  ],
  "tooling_requirements": {{
    "complexity": "<Simple/Medium/Complex/Very Complex>",
    "special_tooling_needed": <true/false>,
    "estimated_setup_time_hours": <float>,
    "notes": "<e.g. deep holes need peck drilling cycle>"
  }},
  "lead_time_estimate_days": <float>,
  "risk_assessment": {{
    "level": "<Low/Medium/High/Critical>",
    "factors": ["<risk grounded in geometry>"],
    "mitigation": ["<specific action>"]
  }},
  "dfm_warnings": [
    {{
      "code": "DFM-XXX",
      "severity": "<critical/high/medium/low>",
      "description": "<cite actual measurement>",
      "recommendation": "<specific fix>"
    }}
  ],
  "ai_confidence": <float 0–1>
}}
"""

    def _parse_ai_response(self, ai_response: str) -> AIDFMInsights:
        """Parse AI response into structured insights"""
        
        try:
            # Try to extract JSON from AI response
            json_start = ai_response.find('{')
            json_end = ai_response.rfind('}') + 1
            
            if json_start != -1 and json_end != -1:
                json_str = ai_response[json_start:json_end]  # type: ignore
                parsed_data = json.loads(json_str)
            else:
                # Fallback: directly return the fallback insights object (no parsing needed)
                return self._create_fallback_insights()
            
            return AIDFMInsights(
                manufacturing_complexity=parsed_data.get('manufacturing_complexity', 50.0),
                process_recommendations=parsed_data.get('process_recommendations', []),
                cost_optimization_suggestions=parsed_data.get('cost_optimization_suggestions', []),
                quality_considerations=parsed_data.get('quality_considerations', []),
                material_recommendations=parsed_data.get('material_recommendations', []),
                tooling_requirements=parsed_data.get('tooling_requirements', {}),
                lead_time_estimate_days=parsed_data.get('lead_time_estimate_days', 5.0),
                risk_assessment=parsed_data.get('risk_assessment', {}),
                ai_confidence=parsed_data.get('ai_confidence', 0.75),
                generation_time_ms=0.0,  # Will be set by caller
                dfm_warnings=parsed_data.get('dfm_warnings', [])
            )
            
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse AI JSON response: {e}")
            return self._extract_insights_from_text(ai_response)
        except Exception as e:
            logger.error(f"Error parsing AI response: {e}")
            return self._create_fallback_insights()
    
    def _extract_insights_from_text(self, text: str) -> AIDFMInsights:
        """Extract insights from unstructured AI text response"""
        
        # Basic text parsing for key insights
        complexity = 50.0
        if "high complexity" in text.lower():
            complexity = 80.0
        elif "low complexity" in text.lower():
            complexity = 30.0
        elif "medium complexity" in text.lower():
            complexity = 50.0
        
        # Extract process recommendations
        processes = []
        if "cnc" in text.lower() or "machining" in text.lower():
            processes.append({
                "name": "CNC Machining",
                "suitability_score": 0.8,
                "cost_factor": 1.2,
                "lead_time": 3
            })
        
        if "3d print" in text.lower() or "additive" in text.lower():
            processes.append({
                "name": "Additive Manufacturing", 
                "suitability_score": 0.7,
                "cost_factor": 1.5,
                "lead_time": 2
            })
        
        return AIDFMInsights(
            manufacturing_complexity=complexity,
            process_recommendations=processes,
            cost_optimization_suggestions=["Consider design simplification", "Evaluate material alternatives"],
            quality_considerations=["Dimensional accuracy requirements", "Surface finish specifications"],
            material_recommendations=[{"name": "Aluminum 6061", "properties": "Good machinability"}],
            tooling_requirements={"complexity": "Medium", "estimated_cost": 1000},
            lead_time_estimate_days=5.0,
            risk_assessment={"level": "Medium", "factors": ["Geometric complexity"]},
            ai_confidence=0.6,
            generation_time_ms=0.0
        )
    
    def _create_fallback_insights(self) -> AIDFMInsights:
        """Create fallback insights when AI is unavailable"""
        
        return AIDFMInsights(
            manufacturing_complexity=50.0,
            process_recommendations=[
                {
                    "name": "CNC Machining",
                    "suitability_score": 0.8,
                    "cost_factor": 1.0,
                    "lead_time": 5,
                    "pros": ["High precision", "Good surface finish"],
                    "cons": ["Higher setup cost", "Material waste"]
                }
            ],
            cost_optimization_suggestions=[
                "Consider design for manufacturability guidelines",
                "Evaluate batch production opportunities",
                "Optimize material utilization"
            ],
            quality_considerations=[
                "Define critical dimensions and tolerances",
                "Establish inspection requirements",
                "Consider surface finish specifications"
            ],
            material_recommendations=[
                {
                    "name": "Aluminum 6061-T6",
                    "properties": "Excellent machinability, good strength-to-weight ratio",
                    "cost_factor": 1.0,
                    "availability": "Excellent"
                }
            ],
            tooling_requirements={
                "complexity": "Medium",
                "estimated_cost_usd": 500,
                "setup_time_hours": 2
            },
            lead_time_estimate_days=7.0,
            risk_assessment={
                "level": "Low-Medium",
                "factors": ["Standard manufacturing processes"],
                "mitigation": "Follow established manufacturing practices"
            },
            ai_confidence=0.7,
            generation_time_ms=50.0
        )
    
    def _merge_ai_with_traditional(
        self, 
        traditional_result: EnhancedDFMResult, 
        ai_insights: AIDFMInsights
    ) -> EnhancedDFMResult:
        """Merge AI insights with traditional DFM analysis"""
        
        # Update manufacturability score with AI insights
        ai_weight = ai_insights.ai_confidence
        traditional_weight = traditional_result.confidence
        
        combined_score = (
            traditional_result.manufacturability_score * traditional_weight + 
            (ai_insights.manufacturing_complexity / 100) * ai_weight
        ) / (traditional_weight + ai_weight)
        
        traditional_result.manufacturability_score = combined_score
        
        # Enhance recommendations
        traditional_result.detailed_recommendations = [
            {
                "category": "Cost Optimization",
                "suggestions": ai_insights.cost_optimization_suggestions,
                "priority": "High"
            },
            {
                "category": "Quality Considerations", 
                "suggestions": ai_insights.quality_considerations,
                "priority": "Medium"
            }
        ]
        
        # Add competitive analysis
        traditional_result.competitive_analysis = {
            "lead_time_days": ai_insights.lead_time_estimate_days,
            "estimated_cost_factor": sum(p.get('cost_factor', 1.0) for p in ai_insights.process_recommendations) / len(ai_insights.process_recommendations) if ai_insights.process_recommendations else 1.0,
            "risk_level": ai_insights.risk_assessment.get('level', 'Medium')
        }
        
        # Add sustainability metrics
        traditional_result.sustainability_metrics = {
            "material_utilization": 0.85,  # Estimated
            "energy_efficiency": "Medium",
            "recyclability": "Good",
            "waste_reduction_potential": 0.3
        }
        
        return traditional_result
    
    def _enhance_traditional_analysis(self, result: EnhancedDFMResult) -> EnhancedDFMResult:
        """Enhance traditional analysis without AI"""
        
        # Add detailed recommendations based on traditional analysis
        result.detailed_recommendations = [
            {
                "category": "Process Selection",
                "suggestions": [f"Consider {process} for optimal results" for process in result.recommended_processes],
                "priority": "High"
            }
        ]
        
        # Add basic competitive analysis
        result.competitive_analysis = {
            "lead_time_days": 7.0,
            "estimated_cost_factor": 1.0,
            "risk_level": result.difficulty_level
        }
        
        # Add basic sustainability metrics
        result.sustainability_metrics = {
            "material_utilization": 0.8,
            "energy_efficiency": "Medium", 
            "recyclability": "Good",
            "waste_reduction_potential": 0.2
        }
        
        return result

    def get_analysis_summary(self, enhanced_result: EnhancedDFMResult) -> Dict[str, Any]:
        """Get comprehensive analysis summary for frontend display"""
        insights = enhanced_result.ai_insights
        
        return {
            "overall_score": enhanced_result.manufacturability_score,
            "difficulty_level": enhanced_result.difficulty_level,
            "ai_enhanced": insights is not None,
            "ai_confidence": insights.ai_confidence if insights else 0.7,
            
            "key_insights": {
                "recommended_processes": enhanced_result.recommended_processes,
                "cost_optimization": insights.cost_optimization_suggestions if insights else [],
                "quality_factors": insights.quality_considerations if insights else [],
                "lead_time_days": insights.lead_time_estimate_days if insights else 7.0
            },
            
            "risk_assessment": insights.risk_assessment if insights else {"level": "Medium"},
            
            "sustainability": enhanced_result.sustainability_metrics,
            
            "detailed_recommendations": enhanced_result.detailed_recommendations
        }