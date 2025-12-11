"use client";

import { useState } from "react";
import { Play, Target, Users, Package } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

interface WarRoomInputProps {
  onRunSimulation: (data: {
    brand: string;
    competitor: string;
    category: string;
  }) => void;
  isLoading?: boolean;
}

export function WarRoomInput({ onRunSimulation, isLoading }: WarRoomInputProps) {
  const [brand, setBrand] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [category, setCategory] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand.trim() || !competitor.trim() || !category.trim()) {
      return;
    }
    onRunSimulation({ brand: brand.trim(), competitor: competitor.trim(), category: category.trim() });
  };

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          War Room Configuration
        </CardTitle>
        <CardDescription>
          Enter your brand, competitor, and product category to analyze AI visibility
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              Target Brand
            </label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g., Acme Corp"
              required
              disabled={isLoading}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Competitor
            </label>
            <input
              type="text"
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              placeholder="e.g., Competitor Inc"
              required
              disabled={isLoading}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4" />
              Product Category
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Enterprise Security Software"
              required
              disabled={isLoading}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <Button
            type="submit"
            disabled={isLoading || !brand.trim() || !competitor.trim() || !category.trim()}
            className="w-full"
          >
            <Play className="h-4 w-4 mr-2" />
            {isLoading ? "Running Simulation..." : "Run Simulation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

