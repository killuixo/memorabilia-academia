import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyjyMRiQVq4VJDHiJQT1t0kFL0pWyNmieJesQt9TqRD-rw6QFBEKjrr9KHh662ABw3s/exec';

  const [activeTab, setActiveTab] = useState('registro'); // 'registro' ou 'acervo'
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data/Hora', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);

  const initialFormState = {
    pacote: '', idItem: '', centro: '', departamento: '',
    estudante1: '', estudante2: '', estudante3: '', orientador: '',
    curso: '', mesAno: '', codigo: '', observacoes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [status, setStatus] = useState('idle');
  
  // Estados do Módulo de Câmera/OCR
  const [ocrStatus, setOcrStatus] = useState('idle'); // idle, loading, success, error
  const [ocrText, setOcrText] = useState('');
  const fileInputRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Carrega o script do Tesseract dinamicamente para não pesar o projeto
  const loadTesseract = () => {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
      const Tesseract = await loadTesseract();
      const result = await Tesseract.recognize(file, 'por', {
        logger: m => console.log(m)
      });
      setOcrText(result.data.text);
      setOcrStatus('success');
    } catch (err) {
      console.error(err);
      setOcrStatus('error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!GOOGLE_SCRIPT_URL) return alert("Erro: URL do Google Script ausente.");

    setStatus('loading');
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      setFormData(initialFormState);
      setOcrText('');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      console.error(error);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const fetchItems = async () => {
    if (!GOOGLE_SCRIPT_URL) return;
    setLoadingList(true);
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const data = await response.json();
      setItems(data);
    } catch (err) {
      console.error("Erro ao buscar dados:", err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'acervo') {
      fetchItems();
    }
  }, [activeTab]);

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedItems = [...items].sort((a, b) => {
    const aValue = a[sortConfig.key] ? a[sortConfig.key].toString().toLowerCase() : '';
    const bValue = b[sortConfig.key] ? b[sortConfig.key].toString().toLowerCase() : '';
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center py-6 px-4 font-sans selection:bg-[#ffb300]">
      <div className="w-full max-w-6xl bg-white border-[12px] border-black shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        
        {/* Cabeçalho e Abas */}
        <div className="flex flex-col md:flex-row border-b-[12px] border-black">
          <div className="bg-[#c2185b] flex-1 p-6 md:p-8 text-white border-b-[12px] md:border-b-0 md:border-r-[12px] border-black">
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">Acervo MEN</h1>
            <p className="mt-1 text-pink-200 font-bold text-lg">Triagem de Relatórios de Estágio</p>
          </div>
          <div className="flex flex-row md:flex-col bg-[#ffb300]">
            <button 
              onClick={() => setActiveTab('registro')}
              className={`flex-1 px-8 py-4 font-black uppercase tracking-wider text-xl border-b-[12px] md:border-r-0 border-r-[12px] border-black transition-colors ${activeTab === 'registro' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Registrar
            </button>
            <button 
              onClick={() => setActiveTab('acervo')}
              className={`flex-1 px-8 py-4 font-black uppercase tracking-wider text-xl transition-colors ${activeTab === 'acervo' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Acervo
            </button>
          </div>
        </div>

        {/* Conteúdo Aba: Registro */}
        {activeTab === 'registro' && (
          <div className="flex flex-col xl:flex-row">
            
            {/* Coluna do Formulário */}
            <div className="flex-[2] p-6 md:p-8">
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                
                {/* Linha 1: Identificadores */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">ID do Pacote/Pardo</label>
                    <input required type="text" name="pacote" value={formData.pacote} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" placeholder="Ex: PCT-001" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">ID do Item (Único)</label>
                    <input required type="text" name="idItem" value={formData.idItem} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" placeholder="Ex: REL-1042" />
                  </div>
                </div>

                {/* Linha 2: Lotação */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">Centro (Ex: CCE, CFH)</label>
                    <input required type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">Departamento</label>
                    <input required type="text" name="departamento" value={formData.departamento} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" placeholder="Ex: Psicologia" />
                  </div>
                </div>

                {/* Linha 3: Estudantes */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide text-sm">Estudante 1</label>
                    <input required type="text" name="estudante1" value={formData.estudante1} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#e0f7fa]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide text-sm">Estudante 2 (Opcional)</label>
                    <input type="text" name="estudante2" value={formData.estudante2} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#e0f7fa]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide text-sm">Estudante 3 (Opcional)</label>
                    <input type="text" name="estudante3" value={formData.estudante3} onChange={handleChange} className="w-full border-[6px] border-black p-3 focus:outline-none focus:bg-[#e0f7fa]" />
                  </div>
                </div>

                {/* Linha 4: Orientador e Curso */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">Nome do Orientador</label>
                    <input required type="text" name="orientador" value={formData.orientador} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">Curso de Licenciatura</label>
                    <input required type="text" name="curso" value={formData.curso} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa]" />
                  </div>
                </div>

                {/* Linha 5: Detalhes IFES */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">Mês e Ano</label>
                    <input required type="month" name="mesAno" value={formData.mesAno} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] bg-white uppercase font-bold" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-black uppercase tracking-wide">Código SIGA IFES</label>
                    <select required name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] font-bold cursor-pointer appearance-none bg-white">
                      <option value="" disabled>Selecione um código...</option>
                      <option value="125.31 - Provas. Exames. Trabalhos">125.31 - Provas. Exames. Trabalhos</option>
                      <option value="125.43 - Assentamentos individuais">125.43 - Assentamentos (Dossiê)</option>
                      <option value="125.62 - Estágios não obrigatórios">125.62 - Estágios não obrigatórios</option>
                      <option value="452.32 - Estágios obrigatórios">452.32 - Estágios obrigatórios</option>
                      <option value="Outro (Especificar na observação)">Outro (Especificar na observação)</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-bold text-black uppercase tracking-wide">Observações</label>
                  <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} rows="2" className="w-full border-[6px] border-black p-3 text-lg focus:outline-none focus:bg-[#e0f7fa] resize-none" />
                </div>

                <button type="submit" disabled={status === 'loading'} className="mt-2 w-full bg-[#c2185b] text-white border-[6px] border-black py-4 font-black text-2xl uppercase tracking-wider hover:bg-[#d81b60] active:translate-y-1 transition-all disabled:opacity-50">
                  {status === 'loading' ? 'Enviando...' : 'Salvar Registro'}
                </button>
                {status === 'success' && <div className="bg-green-300 border-[6px] border-black p-3"><p className="text-black font-black text-center text-lg">✓ Salvo com sucesso!</p></div>}
              </form>
            </div>

            {/* Coluna do OCR (Câmera) */}
            <div className="flex-1 bg-[#00bcd4] border-t-[12px] xl:border-t-0 xl:border-l-[12px] border-black flex flex-col p-6 md:p-8">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight mb-4 border-b-[6px] border-black pb-2">Assistente de Capa</h2>
              <p className="font-bold text-black mb-6 text-sm">Tire uma foto da capa do relatório. O texto será extraído abaixo para você copiar e colar nos campos.</p>
              
              <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleImageCapture} className="hidden" />
              
              <button onClick={() => fileInputRef.current.click()} className="bg-white text-black border-[6px] border-black py-4 font-black text-xl uppercase hover:bg-gray-100 flex items-center justify-center gap-3 active:translate-y-1 transition-transform mb-6">
                <span className="text-2xl">📷</span> Usar Câmera
              </button>

              <div className="flex-1 flex flex-col">
                <label className="font-black text-black uppercase tracking-wide mb-2">Texto Extraído (OCR)</label>
                <textarea 
                  readOnly 
                  value={ocrStatus === 'loading' ? 'Lendo imagem... aguarde.' : ocrText} 
                  className="w-full h-48 xl:h-full border-[6px] border-black p-3 text-base bg-white focus:outline-none resize-none font-mono"
                  placeholder="O texto detectado aparecerá aqui..."
                />
              </div>
            </div>
          </div>
        )}

        {/* Conteúdo Aba: Acervo (Tabela) */}
        {}
        {activeTab === 'acervo' && (
          <div className="p-6 md:p-8 flex flex-col bg-white overflow-hidden min-h-[500px]">
            {loadingList ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="font-black text-2xl uppercase animate-pulse">Carregando Acervo...</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-[6px] border-black">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#ffb300] text-black">
                      {["Data/Hora", "ID Pacote", "ID Item", "Centro", "Departamento", "Estudante 1", "Orientador", "Mês/Ano", "Código IFES"].map((header) => (
                        <th 
                          key={header} 
                          onClick={() => handleSort(header)}
                          className="border-b-[6px] border-black p-4 font-black uppercase text-sm cursor-pointer hover:bg-[#ffe082] transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {header}
                            {sortConfig.key === header && (
                              <span>{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.length === 0 ? (
                      <tr><td colSpan="9" className="p-6 text-center font-bold">Nenhum registro encontrado.</td></tr>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-100 transition-colors border-b-[3px] border-gray-300 last:border-b-0">
                          <td className="p-4 font-mono text-sm">{item["Data/Hora"]}</td>
                          <td className="p-4 font-bold">{item["ID Pacote"]}</td>
                          <td className="p-4 font-bold text-[#c2185b]">{item["ID Item"]}</td>
                          <td className="p-4">{item["Centro"]}</td>
                          <td className="p-4">{item["Departamento"]}</td>
                          <td className="p-4">{item["Estudante 1"]}</td>
                          <td className="p-4">{item["Orientador"]}</td>
                          <td className="p-4 font-bold">{item["Mês/Ano"]}</td>
                          <td className="p-4 text-xs font-mono">{item["Código IFES"]}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
