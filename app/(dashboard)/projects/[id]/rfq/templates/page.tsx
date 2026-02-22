'use client';

import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileText, Download, Edit, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

// Mock template data - replace with API call
const mockTemplates = [
  {
    id: '1',
    name: 'Machining Parts Template',
    description: 'Standard template for machined components with tight tolerances',
    category: 'Machining',
    partTypes: ['CNC Machined', 'Turned Parts', 'Milled Components'],
    fields: ['Material Specification', 'Tolerance Requirements', 'Surface Finish', 'Inspection Reports'],
    lastUpdated: '2024-02-15',
    isActive: true,
  },
  {
    id: '2',
    name: 'Sheet Metal Template',
    description: 'Template for sheet metal fabrication and forming operations',
    category: 'Fabrication',
    partTypes: ['Sheet Metal', 'Bent Parts', 'Welded Assemblies'],
    fields: ['Material Grade', 'Thickness', 'Bend Radius', 'Welding Specs'],
    lastUpdated: '2024-02-10',
    isActive: true,
  },
  {
    id: '3',
    name: 'Casting Template',
    description: 'Template for cast parts including sand casting and die casting',
    category: 'Casting',
    partTypes: ['Sand Casting', 'Die Casting', 'Investment Casting'],
    fields: ['Casting Method', 'Material Grade', 'Post Processing', 'NDT Requirements'],
    lastUpdated: '2024-02-08',
    isActive: false,
  },
];

export default function RFQTemplatesPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = ['all', 'Machining', 'Fabrication', 'Casting'];
  const filteredTemplates = selectedCategory === 'all' 
    ? mockTemplates 
    : mockTemplates.filter(t => t.category === selectedCategory);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* BREADCRUMB & HEADER */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link 
                href={`/projects/${projectId}/rfq`}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to RFQ Management
              </Link>
              <span>/</span>
              <span>RFQ Templates</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              RFQ Templates
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage and use pre-configured RFQ templates for different part categories
            </p>
          </div>
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create New Template
          </Button>
        </div>

        {/* CATEGORY FILTER */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Filter by category:</span>
          {categories.map((category) => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category)}
              className="capitalize"
            >
              {category}
            </Button>
          ))}
        </div>

        {/* TEMPLATES GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template) => (
            <Card key={template.id} className={!template.isActive ? 'opacity-60' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{template.category}</Badge>
                      {template.isActive ? (
                        <Badge className="bg-green-100 text-green-800">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                  </div>
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <CardDescription>{template.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Part Types</h4>
                    <div className="flex flex-wrap gap-1">
                      {template.partTypes.map((type, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium mb-2">Required Fields</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {template.fields.slice(0, 3).map((field, index) => (
                        <li key={index} className="flex items-center gap-1">
                          <span className="w-1 h-1 bg-muted-foreground rounded-full"></span>
                          {field}
                        </li>
                      ))}
                      {template.fields.length > 3 && (
                        <li className="text-xs">+{template.fields.length - 3} more fields</li>
                      )}
                    </ul>
                  </div>

                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-3">
                      Last updated: {template.lastUpdated}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1">
                        <FileText className="h-3 w-3 mr-1" />
                        Use Template
                      </Button>
                      <Button variant="outline" size="sm">
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* EMPTY STATE */}
        {filteredTemplates.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No templates found</h3>
              <p className="text-muted-foreground mb-4">
                No templates match the selected category filter.
              </p>
              <Button onClick={() => setSelectedCategory('all')}>
                Show All Templates
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}