'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Award, 
  ExternalLink, 
  BookOpen, 
  Globe,
  Shield,
  CheckCircle
} from 'lucide-react';

interface MaterialStandard {
  standard: string;
  organization: string;
  specification: string;
  region: string;
  status: 'active' | 'deprecated' | 'draft';
  url?: string;
  description?: string;
}

interface MaterialStandardsDisplayProps {
  materialName: string;
  materialGrade?: string;
  materialSpecification?: string;
  category: string;
  standards?: MaterialStandard[];
}

export function MaterialStandardsDisplay({
  materialName,
  materialGrade,
  category,
  standards = []
}: MaterialStandardsDisplayProps) {
  
  // Generate common standards based on material category and specification
  const generateStandards = (): MaterialStandard[] => {
    const generatedStandards: MaterialStandard[] = [];
    
    // For bearing steels like 100Cr6
    if (materialName.includes('100Cr6') || materialGrade === '1.3505') {
      generatedStandards.push(
        {
          standard: 'ASTM A295',
          organization: 'ASTM International',
          specification: 'Standard Specification for High-Carbon Anti-Friction Bearing Steel',
          region: 'USA',
          status: 'active',
          url: 'https://www.astm.org/a0295-14.html',
          description: 'Covers high-carbon chromium bearing steel for balls, rollers, and races'
        },
        {
          standard: 'DIN 1.3505',
          organization: 'Deutsches Institut für Normung',
          specification: '100Cr6 - Bearing Steel Grade',
          region: 'Europe (DIN)',
          status: 'active',
          description: 'German standard for high carbon chromium bearing steel'
        },
        {
          standard: 'EN ISO 683-17',
          organization: 'European Committee for Standardization',
          specification: 'Heat-treatable steels, alloy steels and free-cutting steels — Part 17: Ball and roller bearing steels',
          region: 'Europe (EN)',
          status: 'active',
          description: 'European standard for bearing steel chemical composition and properties'
        },
        {
          standard: 'JIS SUJ2',
          organization: 'Japanese Standards Association',
          specification: 'High carbon chromium bearing steel',
          region: 'Japan (JIS)',
          status: 'active',
          description: 'Japanese equivalent standard for bearing steel'
        }
      );
    }
    
    // For plastic materials
    if (category.toLowerCase().includes('plastic')) {
      if (materialName.toLowerCase().includes('abs')) {
        generatedStandards.push(
          {
            standard: 'ASTM D4673',
            organization: 'ASTM International',
            specification: 'Standard Classification System for Acrylonitrile-Butadiene-Styrene (ABS) Plastics and Alloys Molding and Extrusion Materials',
            region: 'USA',
            status: 'active',
            description: 'Classification system for ABS plastic materials'
          },
          {
            standard: 'ISO 2580',
            organization: 'International Organization for Standardization',
            specification: 'Plastics — Acrylonitrile-butadiene-styrene (ABS) moulding and extrusion materials',
            region: 'International (ISO)',
            status: 'active',
            description: 'International standard for ABS plastic materials'
          }
        );
      }
    }
    
    // For aluminum alloys
    if (category.toLowerCase().includes('aluminum') || category.toLowerCase().includes('aluminium')) {
      generatedStandards.push(
        {
          standard: 'ASTM B209',
          organization: 'ASTM International',
          specification: 'Standard Specification for Aluminum and Aluminum-Alloy Sheet and Plate',
          region: 'USA',
          status: 'active',
          description: 'Covers aluminum and aluminum-alloy sheet and plate'
        },
        {
          standard: 'EN 573',
          organization: 'European Committee for Standardization',
          specification: 'Aluminium and aluminium alloys — Chemical composition and form of wrought products',
          region: 'Europe (EN)',
          status: 'active',
          description: 'European standard for aluminum alloy chemical composition'
        }
      );
    }
    
    return generatedStandards;
  };

  const allStandards = [...(standards || []), ...generateStandards()];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'deprecated': return 'bg-red-100 text-red-800';
      case 'draft': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRegionFlag = (region: string) => {
    const flags: { [key: string]: string } = {
      'USA': '🇺🇸',
      'Europe (EN)': '🇪🇺',
      'Europe (DIN)': '🇩🇪',
      'Japan (JIS)': '🇯🇵',
      'International (ISO)': '🌍',
      'China (GB)': '🇨🇳',
      'India (IS)': '🇮🇳'
    };
    return flags[region] || '🏳️';
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5" />
          Material Standards & Specifications
          <Badge variant="secondary">{allStandards.length} standards</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Industry standards and specifications for {materialName}
          {materialGrade && ` (${materialGrade})`}
        </p>
      </CardHeader>
      <CardContent>
        {allStandards.length > 0 ? (
          <div className="space-y-4">
            {/* Quick Reference Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {allStandards.filter(s => s.region === 'USA').length}
                  </div>
                  <div className="text-xs text-muted-foreground">🇺🇸 ASTM Standards</div>
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {allStandards.filter(s => s.region.includes('Europe')).length}
                  </div>
                  <div className="text-xs text-muted-foreground">🇪🇺 European Standards</div>
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {allStandards.filter(s => s.region.includes('Japan')).length}
                  </div>
                  <div className="text-xs text-muted-foreground">🇯🇵 JIS Standards</div>
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {allStandards.filter(s => s.region.includes('International')).length}
                  </div>
                  <div className="text-xs text-muted-foreground">🌍 ISO Standards</div>
                </div>
              </Card>
            </div>

            {/* Standards Table */}
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Region</TableHead>
                    <TableHead className="w-[140px]">Standard</TableHead>
                    <TableHead className="w-[160px]">Organization</TableHead>
                    <TableHead>Specification</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[80px]">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allStandards.map((standard, index) => (
                    <TableRow key={index} className="hover:bg-gray-50">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getRegionFlag(standard.region)}</span>
                          <span className="text-xs">{standard.region.split(' ')[0]}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {standard.standard}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{standard.organization}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{standard.specification}</p>
                          {standard.description && (
                            <p className="text-xs text-muted-foreground">{standard.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(standard.status)}>
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {standard.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {standard.url ? (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                            <a href={standard.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Additional Information */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-4">
              <div className="flex items-center gap-1">
                <Shield className="h-4 w-4" />
                <span>Standards compliance ensures material quality and traceability</span>
              </div>
              <div className="flex items-center gap-1">
                <BookOpen className="h-4 w-4" />
                <span>Refer to latest standard revisions for current specifications</span>
              </div>
              <div className="flex items-center gap-1">
                <Globe className="h-4 w-4" />
                <span>Regional standards may have different requirements</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Award className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-2">No Standards Available</h3>
            <p className="text-sm">
              No industry standards have been identified for this material.
              <br />
              Contact your material supplier for relevant specifications.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}