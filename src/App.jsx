import React, { useState } from 'react';

export default function App() {
  // Puxando a URL diretamente das variáveis de ambiente da Vercel (Padrão Vite)
  const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL || '';

  const [formData, setFormData] = useState({
    pacote: '',
    estudante: '',
    curso: '',
    ano: '',
    codigo: '',
    observacoes: ''
  });

  const [status, setStatus] = useState('idle'); // idle, loading, success, error

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!GOOGLE_SCRIPT_URL) {
      alert("Erro: A URL do Google Script não foi configurada nas variáveis de ambiente.");
      return;
    }

    setStatus('loading');
    
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors', // Necessário para evitar bloqueios de CORS do Google Sheets
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      });
      
      // O mode no-cors não retorna o status 200 tradicional, então assumimos sucesso se não cair no catch
      setStatus('success');
      setFormData({ pacote: '', estudante: '', curso: '', ano: '', codigo: '', observacoes: '' });
      
      setTimeout(() => setStatus('idle'), 4000);
    } catch (error) {
      console.error(error);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center justify-center p-4 md:p-8 font-sans">
      
      {/* Main Mondrian Container */}
      <div className="w-full max-w-3xl bg-white border-[12px] border-black shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-hidden">
        
        {/* Top Header Block - Dark Pink */}
        <div className="bg-[#c2185b] text-white border-b-[12px] border-black p-6 md:p-8">
          <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight">Triagem IFES</h1>
          <p className="mt-2 text-pink-100 font-bold text-lg md:text-xl">Verificação de Relatórios de Estágio - MEN</p>
        </div>

        {/* Content Block */}
        <div className="flex flex-col md:flex-row">
          
          {/* Form Area */}
          <div className="flex-1 p-6 md:p-8 flex flex-col gap-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              
              <div className="flex flex-col gap-1">
                <label className="font-bold text-black uppercase tracking-wide">ID do Pacote/Papel Pardo</label>
                <input 
                  required
                  type="text" 
                  name="pacote"
                  value={formData.pacote}
                  onChange={handleChange}
                  className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] transition-colors"
                  placeholder="Ex: PCT-001"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-black uppercase tracking-wide">Nome do Estudante</label>
                <input 
                  required
                  type="text" 
                  name="estudante"
                  value={formData.estudante}
                  onChange={handleChange}
                  className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] transition-colors"
                  placeholder="Nome completo"
                />
              </div>

              <div className="flex flex-col md:flex-row gap-5">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="font-bold text-black uppercase tracking-wide">Curso de Licenciatura</label>
                  <input 
                    required
                    type="text" 
                    name="curso"
                    value={formData.curso}
                    onChange={handleChange}
                    className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] transition-colors"
                    placeholder="Ex: História, Letras..."
                  />
                </div>
                <div className="flex flex-col gap-1 w-full md:w-1/3">
                  <label className="font-bold text-black uppercase tracking-wide">Ano/Semestre</label>
                  <input 
                    required
                    type="text" 
                    name="ano"
                    value={formData.ano}
                    onChange={handleChange}
                    className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] transition-colors"
                    placeholder="Ex: 2021.2"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-black uppercase tracking-wide">Código de Classificação (SIGA IFES)</label>
                <select 
                  required
                  name="codigo"
                  value={formData.codigo}
                  onChange={handleChange}
                  className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] font-bold transition-colors cursor-pointer appearance-none bg-white"
                >
                  <option value="" disabled>Selecione um código adequado...</option>
                  <option value="125.31 - Provas. Exames. Trabalhos">125.31 - Provas. Exames. Trabalhos (Relatórios avulsos)</option>
                  <option value="125.43 - Assentamentos individuais">125.43 - Assentamentos individuais (Dossiê de Aluno)</option>
                  <option value="125.62 - Estágios não obrigatórios">125.62 - Estágios não obrigatórios</option>
                  <option value="452.32 - Estágios obrigatórios (Ensino Técnico)">452.32 - Estágios obrigatórios (Ensino Técnico)</option>
                  <option value="Outro (Especificar na observação)">Outro (Especificar na observação)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-black uppercase tracking-wide">Observações</label>
                <textarea 
                  name="observacoes"
                  value={formData.observacoes}
                  onChange={handleChange}
                  rows="3"
                  className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] transition-colors resize-none"
                  placeholder="Detalhes adicionais sobre o estado do documento ou departamento de destino..."
                ></textarea>
              </div>

              <button 
                type="submit" 
                disabled={status === 'loading'}
                className="mt-4 w-full bg-[#00bcd4] text-black border-[6px] border-black py-4 font-black text-2xl uppercase tracking-wider hover:bg-[#26c6da] active:translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {status === 'loading' ? 'Enviando...' : 'Registrar na Planilha'}
              </button>

              {/* Status Messages */}
              {status === 'success' && (
                <div className="bg-green-100 border-[6px] border-black p-4 mt-2">
                  <p className="text-green-800 font-bold text-center text-lg">✓ Documento registrado com sucesso!</p>
                </div>
              )}
              {status === 'error' && (
                <div className="bg-red-100 border-[6px] border-black p-4 mt-2">
                  <p className="text-red-800 font-bold text-center text-lg">✗ Erro ao registrar. Verifique a configuração da URL.</p>
                </div>
              )}
            </form>
          </div>

          {/* Side Color Blocks - Desktop Only */}
          <div className="hidden md:flex w-1/4 border-l-[12px] border-black flex-col">
            <div className="flex-1 bg-[#ffb300] border-b-[12px] border-black"></div>
            <div className="h-48 bg-white border-b-[12px] border-black relative">
               <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNjY2MiLz48L3N2Zz4=')] opacity-50"></div>
            </div>
            <div className="h-32 bg-[#00bcd4]"></div>
          </div>
        </div>

        {/* Bottom Block - Dark Gold */}
        <div className="h-12 bg-[#ffb300] border-t-[12px] border-black w-full flex items-center justify-end px-4">
           <span className="text-black font-black text-xs uppercase tracking-widest opacity-60">UFSC · ARQUIVOLOGIA</span>
        </div>
      </div>
      
    </div>
  );
}
