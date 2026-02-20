'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Edit2, Check, X, Mail, Plus, Trash2, Users, ChevronDown, Shield, Eye, UserCog, Wrench, PenTool, ShoppingCart, ClipboardCheck, DollarSign, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { useProjectTeam, useAddTeamMember, useRemoveTeamMember, useUpdateTeamMember } from '@/lib/api/hooks/useProjectTeam';
import { TeamMemberRole } from '@/lib/api/project-team';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';
import { Country, State, City } from 'country-state-city';

interface ProjectDetailsCardProps {
  project: {
    id: string;
    name: string;
    description?: string;
    country?: string;
    state?: string;
    city?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
    updatedBy?: string;
    industry?: string;
    estimatedAnnualVolume?: number;
    targetBomCost?: number;
    targetBomCostCurrency?: string;
  };
  onUpdate?: (data: { name?: string; description?: string; country?: string; state?: string; city?: string; industry?: string; estimatedAnnualVolume?: number; targetBomCost?: number; targetBomCostCurrency?: string }) => Promise<void>;
}

export function ProjectDetailsCard({ project, onUpdate }: ProjectDetailsCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: project.name,
    description: project.description || '',
    country: project.country || '',
    state: project.state || '',
    city: project.city || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');

  // For cascading dropdowns - store ISO codes
  const [selectedCountryCode, setSelectedCountryCode] = useState('');
  const [availableStates, setAvailableStates] = useState<any[]>([]);
  const [availableCities, setAvailableCities] = useState<any[]>([]);

  // Sync form with project data when project updates
  useEffect(() => {
    setEditForm({
      name: project.name,
      description: project.description || '',
      country: project.country || '',
      state: project.state || '',
      city: project.city || '',
    });
  }, [project.name, project.description, project.country, project.state, project.city]);

  // Initialize ISO codes from project data
  useEffect(() => {
    if (project.country) {
      const country = Country.getAllCountries().find(c => c.name === project.country);
      if (country) {
        setSelectedCountryCode(country.isoCode);
        const states = State.getStatesOfCountry(country.isoCode);
        setAvailableStates(states);

        if (project.state) {
          const state = states.find(s => s.name === project.state);
          if (state) {
            setAvailableCities(City.getCitiesOfState(country.isoCode, state.isoCode));
          }
        }
      }
    }
  }, [project.country, project.state]);

  // Prepare options for Combobox
  const countryOptions: ComboboxOption[] = useMemo(
    () =>
      Country.getAllCountries().map((country) => ({
        value: country.name,
        label: country.name,
      })),
    []
  );

  const stateOptions: ComboboxOption[] = useMemo(
    () =>
      availableStates.map((state) => ({
        value: state.name,
        label: state.name,
      })),
    [availableStates]
  );

  const cityOptions: ComboboxOption[] = useMemo(
    () =>
      availableCities.map((city) => ({
        value: city.name,
        label: city.name,
      })),
    [availableCities]
  );

  // Team management hooks
  const { data: teamData, isLoading: isLoadingTeam } = useProjectTeam(project.id);
  const addMemberMutation = useAddTeamMember(project.id);
  const removeMemberMutation = useRemoveTeamMember(project.id);
  const updateMemberMutation = useUpdateTeamMember(project.id);

  const handleAddMember = async () => {
    if (!newMemberEmail.trim()) return;

    try {
      await addMemberMutation.mutateAsync({ email: newMemberEmail, role: 'member' });
      setNewMemberEmail('');
      setIsAddingMember(false);
    } catch (error) {
      // Error handling is done in the mutation
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (confirm('Are you sure you want to remove this team member?')) {
      await removeMemberMutation.mutateAsync(memberId);
    }
  };

  const handleEmailClick = (email: string) => {
    window.location.href = `mailto:${email}`;
  };

  const handleUpdateRole = async (memberId: string, newRole: TeamMemberRole) => {
    await updateMemberMutation.mutateAsync({ memberId, data: { role: newRole } });
  };

  const handleCountryChange = (countryName: string) => {
    const country = Country.getAllCountries().find(c => c.name === countryName);
    if (country) {
      setSelectedCountryCode(country.isoCode);
      const states = State.getStatesOfCountry(country.isoCode);
      setAvailableStates(states);
      setAvailableCities([]);
      setEditForm({ ...editForm, country: countryName, state: '', city: '' });
    }
  };

  const handleStateChange = (stateName: string) => {
    const state = availableStates.find(s => s.name === stateName);
    if (state && selectedCountryCode) {
      const cities = City.getCitiesOfState(selectedCountryCode, state.isoCode);
      setAvailableCities(cities);
      setEditForm({ ...editForm, state: stateName, city: '' });
    }
  };

  const handleCityChange = (cityName: string) => {
    setEditForm({ ...editForm, city: cityName });
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner':
        return <Shield className="h-3 w-3" />;
      case 'admin':
        return <UserCog className="h-3 w-3" />;
      case 'project_manager':
        return <Settings className="h-3 w-3" />;
      case 'design_engineer':
        return <PenTool className="h-3 w-3" />;
      case 'manufacturing_engineer':
        return <Wrench className="h-3 w-3" />;
      case 'procurement_manager':
        return <ShoppingCart className="h-3 w-3" />;
      case 'quality_engineer':
        return <ClipboardCheck className="h-3 w-3" />;
      case 'finance_analyst':
        return <DollarSign className="h-3 w-3" />;
      case 'member':
        return <Users className="h-3 w-3" />;
      case 'viewer':
        return <Eye className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'owner':
        return 'Full access - Can edit project, manage team, delete project';
      case 'admin':
        return 'Can edit project and manage team members';
      case 'project_manager':
        return 'BOM, Process Planning, Supplier Management & Team Management';
      case 'design_engineer':
        return 'BOM Management, Technical Drawings & CAD Access';
      case 'manufacturing_engineer':
        return 'Process Planning, Costing & Production Planning';
      case 'procurement_manager':
        return 'Supplier Evaluation, Nomination & Cost Analysis';
      case 'quality_engineer':
        return 'Quality Control, Inspection Plans & Compliance';
      case 'finance_analyst':
        return 'Cost Validation, Financial Analysis & Reporting';
      case 'member':
        return 'Can edit project data (BOM, processes, etc.)';
      case 'viewer':
        return 'Read-only access to assigned modules';
      default:
        return '';
    }
  };

  const ownerMember = teamData?.members.find(m => m.role === 'owner');

  const handleSave = async () => {
    if (!onUpdate) return;

    setIsSaving(true);
    try {
      await onUpdate({
        name: editForm.name !== project.name ? editForm.name : undefined,
        description: editForm.description !== (project.description || '') ? editForm.description : undefined,
        country: editForm.country !== (project.country || '') ? editForm.country : undefined,
        state: editForm.state !== (project.state || '') ? editForm.state : undefined,
        city: editForm.city !== (project.city || '') ? editForm.city : undefined,
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update project:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditForm({
      name: project.name,
      description: project.description || '',
      country: project.country || '',
      state: project.state || '',
      city: project.city || '',
    });
    setIsEditing(false);
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM dd, yyyy h:mm a');
    } catch {
      return dateString;
    }
  };

  return (
    <Card className="border-l-4 border-l-primary shadow-md">
      <CardHeader className="bg-primary py-3 px-6">
        <div className="flex items-center justify-between">
          <h6 className="m-0 font-semibold text-primary-foreground text-sm">
            Project Details
          </h6>
          {!isEditing && onUpdate && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-primary-foreground hover:bg-primary-foreground/20"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="h-3.5 w-3.5 mr-2" />
              Edit
            </Button>
          )}
          {isEditing && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-primary-foreground hover:bg-primary-foreground/20"
                onClick={handleCancel}
                disabled={isSaving}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8"
                onClick={handleSave}
                disabled={isSaving}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Project Name */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Name
            </label>
            {isEditing ? (
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="max-w-lg"
                placeholder="Enter project name"
              />
            ) : (
              <div className="text-base font-semibold">{project.name}</div>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Status
            </label>
            <Badge
              variant={
                project.status === 'active'
                  ? 'default'
                  : project.status === 'completed'
                  ? 'secondary'
                  : 'outline'
              }
              className="text-xs capitalize"
            >
              {project.status.replace('_', ' ')}
            </Badge>
          </div>
        </div>

        {/* Description */}
        <div className="grid grid-cols-1">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Description
            </label>
            {isEditing ? (
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="max-w-2xl min-h-[100px]"
                placeholder="Enter project description"
              />
            ) : (
              <div className="text-base">
                {project.description || <span className="text-muted-foreground italic">No description</span>}
              </div>
            )}
          </div>
        </div>

        {/* Location Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Country */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Country
            </label>
            {isEditing ? (
              <Combobox
                options={countryOptions}
                value={editForm.country}
                onValueChange={handleCountryChange}
                placeholder="Select country"
                searchPlaceholder="Search countries..."
                emptyText="No country found."
              />
            ) : (
              <div className="text-base">
                {project.country || <span className="text-muted-foreground italic">Not specified</span>}
              </div>
            )}
          </div>

          {/* State/Province */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              State/Province
            </label>
            {isEditing ? (
              <Combobox
                options={stateOptions}
                value={editForm.state}
                onValueChange={handleStateChange}
                placeholder="Select state/province"
                searchPlaceholder="Search states..."
                emptyText="No state found."
                disabled={!editForm.country || availableStates.length === 0}
              />
            ) : (
              <div className="text-base">
                {project.state || <span className="text-muted-foreground italic">Not specified</span>}
              </div>
            )}
          </div>

          {/* City */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              City
            </label>
            {isEditing ? (
              <Combobox
                options={cityOptions}
                value={editForm.city}
                onValueChange={handleCityChange}
                placeholder="Select city"
                searchPlaceholder="Search cities..."
                emptyText="No city found."
                disabled={!editForm.state || availableCities.length === 0}
              />
            ) : (
              <div className="text-base">
                {project.city || <span className="text-muted-foreground italic">Not specified</span>}
              </div>
            )}
          </div>
        </div>

        {/* Timestamps Section */}
        <div className="pt-4 border-t border-border">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Created Information */}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Date Created
                </label>
                <div className="text-base">{formatDate(project.createdAt)}</div>
              </div>
              {project.createdBy && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Created By
                  </label>
                  <div className="flex items-center gap-2">
                    <a
                      href={`mailto:${project.createdBy}`}
                      className="text-base text-primary hover:underline flex items-center gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      {project.createdBy}
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Modified Information */}
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Date Last Modified
                </label>
                <div className="text-base">{formatDate(project.updatedAt)}</div>
              </div>
              {project.updatedBy && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Last Modified By
                  </label>
                  <div className="flex items-center gap-2">
                    <a
                      href={`mailto:${project.updatedBy}`}
                      className="text-base text-primary hover:underline flex items-center gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      {project.updatedBy}
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Project Summary Snapshot */}
        <div className="pt-4 border-t border-border">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-foreground">Project Summary Snapshot</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Industry</label>
              <div className="text-base">
                {project.industry ? (
                  <span className="capitalize">{project.industry.replace('-', ' ')}</span>
                ) : (
                  <span className="text-muted-foreground italic">Not specified</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Estimated Annual Volume</label>
              <div className="text-base">
                {project.estimatedAnnualVolume ? (
                  <span>{project.estimatedAnnualVolume.toLocaleString()} units</span>
                ) : (
                  <span className="text-muted-foreground italic">Not specified</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Target BOM Cost</label>
              <div className="text-base">
                {project.targetBomCost ? (
                  <span>
                    {project.targetBomCostCurrency || 'USD'} {project.targetBomCost.toLocaleString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">Not specified</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Team Members Section */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <label className="text-sm font-medium text-muted-foreground">
                Team Members
              </label>
              {teamData && (
                <Badge variant="secondary" className="text-xs">
                  {teamData.total}
                </Badge>
              )}
            </div>
            {!isAddingMember && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddingMember(true)}
                className="h-8"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Member
              </Button>
            )}
          </div>

          {/* Project Owner/Admin Display */}
          {ownerMember && (
            <div className="mb-4 p-4 bg-primary/5 rounded-lg border-2 border-primary/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/30">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Project Owner
                    </span>
                    <Badge variant="default" className="text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      Owner
                    </Badge>
                  </div>
                  {ownerMember.name && (
                    <div className="text-sm font-semibold mt-0.5">{ownerMember.name}</div>
                  )}
                  <button
                    onClick={() => handleEmailClick(ownerMember.email)}
                    className="text-sm text-primary hover:underline flex items-center gap-1.5 mt-1 group"
                  >
                    <Mail className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    {ownerMember.email}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add Member Form */}
          {isAddingMember && (
            <div className="mb-4 p-4 bg-muted/50 rounded-lg border border-border">
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="Enter email address"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddMember();
                    } else if (e.key === 'Escape') {
                      setIsAddingMember(false);
                      setNewMemberEmail('');
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={handleAddMember}
                  disabled={!newMemberEmail.trim() || addMemberMutation.isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setIsAddingMember(false);
                    setNewMemberEmail('');
                  }}
                  disabled={addMemberMutation.isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Team Members List */}
          {isLoadingTeam ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading team members...
            </div>
          ) : teamData && teamData.members.filter(m => m.role !== 'owner').length > 0 ? (
            <div className="space-y-2">
              {teamData.members
                .filter(m => m.role !== 'owner')
                .map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-medium text-primary">
                          {member.name ? member.name.charAt(0).toUpperCase() : member.email.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        {member.name && (
                          <div className="text-sm font-medium truncate">{member.name}</div>
                        )}
                        <button
                          onClick={() => handleEmailClick(member.email)}
                          className="text-sm text-primary hover:underline flex items-center gap-1 group"
                        >
                          <Mail className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          <span className="truncate">{member.email}</span>
                        </button>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {getRoleDescription(member.role)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      {/* Role Selector Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs capitalize"
                            disabled={updateMemberMutation.isPending}
                          >
                            {getRoleIcon(member.role)}
                            <span className="ml-1.5">{member.role}</span>
                            <ChevronDown className="h-3 w-3 ml-1.5 opacity-50" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuLabel>Change Role</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(member.id, 'project_manager')}
                            disabled={member.role === 'project_manager'}
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            <div>
                              <div className="font-medium">Project Manager</div>
                              <div className="text-xs text-muted-foreground">
                                All modules + team management
                              </div>
                            </div>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(member.id, 'design_engineer')}
                            disabled={member.role === 'design_engineer'}
                          >
                            <PenTool className="h-4 w-4 mr-2" />
                            <div>
                              <div className="font-medium">Design Engineer</div>
                              <div className="text-xs text-muted-foreground">
                                BOM Management & CAD access
                              </div>
                            </div>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(member.id, 'manufacturing_engineer')}
                            disabled={member.role === 'manufacturing_engineer'}
                          >
                            <Wrench className="h-4 w-4 mr-2" />
                            <div>
                              <div className="font-medium">Manufacturing Engineer</div>
                              <div className="text-xs text-muted-foreground">
                                Process Planning & Costing
                              </div>
                            </div>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(member.id, 'procurement_manager')}
                            disabled={member.role === 'procurement_manager'}
                          >
                            <ShoppingCart className="h-4 w-4 mr-2" />
                            <div>
                              <div className="font-medium">Procurement Manager</div>
                              <div className="text-xs text-muted-foreground">
                                Supplier Evaluation & Nomination
                              </div>
                            </div>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(member.id, 'quality_engineer')}
                            disabled={member.role === 'quality_engineer'}
                          >
                            <ClipboardCheck className="h-4 w-4 mr-2" />
                            <div>
                              <div className="font-medium">Quality Engineer</div>
                              <div className="text-xs text-muted-foreground">
                                Quality Control & Compliance
                              </div>
                            </div>
                          </DropdownMenuItem>
                          
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(member.id, 'finance_analyst')}
                            disabled={member.role === 'finance_analyst'}
                          >
                            <DollarSign className="h-4 w-4 mr-2" />
                            <div>
                              <div className="font-medium">Finance Analyst</div>
                              <div className="text-xs text-muted-foreground">
                                Cost Analysis & Financial Reporting
                              </div>
                            </div>
                          </DropdownMenuItem>
                          
                          <DropdownMenuSeparator />
                          
                          <DropdownMenuItem
                            onClick={() => handleUpdateRole(member.id, 'viewer')}
                            disabled={member.role === 'viewer'}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            <div>
                              <div className="font-medium">Viewer</div>
                              <div className="text-xs text-muted-foreground">
                                Read-only access to modules
                              </div>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Remove Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveMember(member.id)}
                        disabled={removeMemberMutation.isPending}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Remove member"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No additional team members. Add members to collaborate on this project.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
