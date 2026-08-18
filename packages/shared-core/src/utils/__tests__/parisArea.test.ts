import { describe, it, expect } from 'vitest';
import { ARRONDISSEMENTS } from '../../constants/config.js';
import {
  postcodeToArrondissement,
  cityToNearbyTown,
  resolveAreaLabel,
} from '../parisArea.js';

describe('postcodeToArrondissement', () => {
  it('maps all 20 Paris postcodes to their arrondissement labels', () => {
    for (let i = 1; i <= 20; i++) {
      const postcode = `750${String(i).padStart(2, '0')}`;
      expect(postcodeToArrondissement(postcode)).toBe(ARRONDISSEMENTS[i - 1]);
    }
  });

  it("maps '75001' to '1er' and '75002' to '2e' (ordinal shapes)", () => {
    expect(postcodeToArrondissement('75001')).toBe('1er');
    expect(postcodeToArrondissement('75002')).toBe('2e');
    expect(postcodeToArrondissement('75020')).toBe('20e');
  });

  it("maps the 75116 special case to '16e'", () => {
    expect(postcodeToArrondissement('75116')).toBe('16e');
  });

  it('returns null for non-Paris and malformed inputs', () => {
    expect(postcodeToArrondissement('92100')).toBeNull(); // Boulogne
    expect(postcodeToArrondissement('75000')).toBeNull(); // no 0e
    expect(postcodeToArrondissement('75021')).toBeNull(); // no 21e
    expect(postcodeToArrondissement('7501')).toBeNull(); // too short
    expect(postcodeToArrondissement('750010')).toBeNull(); // too long
    expect(postcodeToArrondissement('')).toBeNull();
    expect(postcodeToArrondissement('paris')).toBeNull();
  });

  it('tolerates surrounding whitespace (autocomplete payloads vary)', () => {
    expect(postcodeToArrondissement(' 75016 ')).toBe('16e');
  });
});

describe('cityToNearbyTown', () => {
  it('matches a town exactly as listed', () => {
    expect(cityToNearbyTown('Boulogne-Billancourt')).toBe('Boulogne-Billancourt');
  });

  it('matches case-insensitively', () => {
    expect(cityToNearbyTown('boulogne-billancourt')).toBe('Boulogne-Billancourt');
    expect(cityToNearbyTown('VINCENNES')).toBe('Vincennes');
  });

  it('matches diacritic-insensitively (accent variance in geocoder output)', () => {
    expect(cityToNearbyTown('Saint-Mande')).toBe('Saint-Mandé');
    expect(cityToNearbyTown('le pre-saint-gervais')).toBe('Le Pré-Saint-Gervais');
    expect(cityToNearbyTown('Le Kremlin-Bicetre')).toBe('Le Kremlin-Bicêtre');
  });

  it('returns the canonical constant value, not the caller casing', () => {
    expect(cityToNearbyTown('saint-mandé')).toBe('Saint-Mandé');
  });

  it('returns null for unknown or empty cities', () => {
    expect(cityToNearbyTown('Paris')).toBeNull();
    expect(cityToNearbyTown('Versailles')).toBeNull();
    expect(cityToNearbyTown('')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(cityToNearbyTown(' Vincennes ')).toBe('Vincennes');
  });
});

describe('resolveAreaLabel', () => {
  it('prefers the arrondissement when the postcode is a Paris one', () => {
    expect(resolveAreaLabel({ postcode: '75005', city: 'Paris' })).toBe('5e');
  });

  it('falls back to the nearby town when the postcode is not Paris', () => {
    expect(resolveAreaLabel({ postcode: '92100', city: 'Boulogne-Billancourt' })).toBe(
      'Boulogne-Billancourt',
    );
  });

  it('resolves the 75116 special case ahead of any city fallback', () => {
    expect(resolveAreaLabel({ postcode: '75116', city: 'Paris' })).toBe('16e');
  });

  it('returns null when neither resolves', () => {
    expect(resolveAreaLabel({ postcode: '78000', city: 'Versailles' })).toBeNull();
  });

  it('handles missing fields', () => {
    expect(resolveAreaLabel({})).toBeNull();
    expect(resolveAreaLabel({ postcode: '75010' })).toBe('10e');
    expect(resolveAreaLabel({ city: 'Pantin' })).toBe('Pantin');
  });
});
